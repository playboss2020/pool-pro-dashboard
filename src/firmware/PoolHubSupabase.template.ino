#define PAIR_ID "POOL_001"

#include <Arduino.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WiFiManager.h>
#include <SPI.h>
#include <RadioLib.h>
#include <math.h>
#include <time.h>
#include <Wire.h>
#include "SSD1306Wire.h"

// ===== Optional Supabase/React cloud integration =====
// Local automation remains the source of truth. Cloud calls are skipped when
// CLOUD_ENABLED is false, WiFi is down, or Supabase is unavailable.
constexpr bool CLOUD_ENABLED = true;
constexpr char SUPABASE_URL[] = "https://pqqtztrnwmgrxxzoenyz.supabase.co";
constexpr char SUPABASE_ANON_KEY[] = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBxcXR6dHJud21ncnh4em9lbnl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMTEzNjAsImV4cCI6MjA5MzY4NzM2MH0.z67ikvfmLWY4w4Oj2EHezIuGq4f--WXB8fAVfULRut8";
constexpr char DEVICE_ID[] = "pool-hub-001";
constexpr char DEVICE_SECRET[] = "ba5e55d0aa8d3621d76679167dfd74c97913912cbd3e71a7";
constexpr unsigned long CLOUD_STATE_INTERVAL_MS = 30000;
constexpr unsigned long CLOUD_COMMAND_POLL_MS = 1000;
constexpr unsigned long CLOUD_COMMAND_POLL_MQTT_ONLINE_MS = 30000;
constexpr unsigned long CLOUD_HISTORY_INTERVAL_MS = 300000;
constexpr unsigned long CLOUD_SCHEDULE_SYNC_MS = 15UL * 60UL * 1000UL;
constexpr unsigned long CLOUD_IMPORTANT_STATE_THROTTLE_MS = 1500;
constexpr char FIRMWARE_VERSION[] = "pool-hub-v5-supabase";

// ===== Optional MQTT fast command path =====
// Fill these after creating your MQTT broker. Supabase polling remains backup.
constexpr bool MQTT_ENABLED = true;
constexpr char MQTT_HOST[] = "493054fef9d042fdbcdf509fb3794ec1.s1.eu.hivemq.cloud";
constexpr uint16_t MQTT_PORT = 8883;
constexpr char MQTT_USERNAME[] = "WORKFLOW";
constexpr char MQTT_PASSWORD[] = "Ad81252214";
constexpr unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;
constexpr unsigned long MQTT_AUTH_RETRY_INTERVAL_MS = 60000;
constexpr unsigned long MQTT_COMMAND_QUEUE_TIMEOUT_MS = 8000;
constexpr uint8_t MQTT_COMMAND_QUEUE_SIZE = 4;

void markCommandCompleted(const String& commandId);
void markCommandFailed(const String& commandId, const String& error);
bool executeCloudCommand(const String& commandId, const String& commandType, const String& payload, String& error);
void requestNodeSync();
void startPumpManualOverride(int targetState);
void startHeaterManualOverride(int targetState);
void cancelPendingBackgroundTraffic();
void sendCloudCommandWithAck(const String& body, const String& commandId);
void updateDisplay();
void serviceQueuedMqttCommand();
void requestFastStateUpdate(const String& reason);
void publishMqttState();

// OLED on Heltec V3
SSD1306Wire display(0x3c, 17, 18);

// Tiny local millis scheduler for periodic hub services.
class LocalTimer {
public:
  using Callback = void (*)();

  void setInterval(unsigned long intervalMs, Callback callback) {
    if (count >= MAX_TASKS || callback == nullptr) return;
    tasks[count].intervalMs = intervalMs;
    tasks[count].lastRun = millis();
    tasks[count].callback = callback;
    count++;
  }

  void run() {
    unsigned long now = millis();
    for (uint8_t i = 0; i < count; i++) {
      if (now - tasks[i].lastRun >= tasks[i].intervalMs) {
        tasks[i].lastRun = now;
        tasks[i].callback();
      }
    }
  }

private:
  struct Task {
    unsigned long intervalMs;
    unsigned long lastRun;
    Callback callback;
  };

  static const uint8_t MAX_TASKS = 12;
  Task tasks[MAX_TASKS];
  uint8_t count = 0;
};

// Heltec V3 SX1262
SX1262 radio = new Module(8, 14, 12, 13);

LocalTimer timer;
Preferences prefs;
WiFiClientSecure mqttSecureClient;
PubSubClient mqttClient(mqttSecureClient);

volatile bool radioFlag = false;
bool radioBusyTx = false;

String lastReply = "Waiting...";
int nextCmdId = 1;

bool awaitingAck = false;
int pendingCmdId = -1;
String pendingBody = "";
String pendingCloudCommandId = "";
unsigned long ackStart = 0;
int retryCount = 0;

const unsigned long ACK_TIMEOUT_MS = 1200;
const int MAX_RETRIES = 8;

// Track last packet received from node for OLED LoRa status
unsigned long lastLoRaRxMillis = 0;

// Save radio quality values
float lastLoRaRssi = NAN;
float lastLoRaSnr = NAN;

// keepalive
unsigned long lastPingMillis = 0;
const unsigned long PING_INTERVAL_MS = 5000;

// Menu button / screen system
#define MENU_BUTTON_PIN 0

int currentScreen = 0;
bool lastButtonReading = HIGH;
bool stableButtonState = HIGH;
bool menuButtonPressLatched = false;
bool menuButtonDown = false;
bool menuLongPressHandled = false;
bool menuShortPressHandled = false;
unsigned long lastDebounceTime = 0;
unsigned long lastMenuActionMillis = 0;
unsigned long lastAcceptedMenuPressMillis = 0;
unsigned long menuButtonDownMillis = 0;
unsigned long wifiResetConfirmUntil = 0;
volatile bool menuButtonInterruptPending = false;

const unsigned long BUTTON_DEBOUNCE_MS = 50;
const unsigned long MENU_PRESS_GUARD_MS = 180;
const unsigned long MENU_LONG_PRESS_MS = 3000;
const unsigned long MENU_TIMEOUT_MS = 40000;
const unsigned long WIFI_RESET_CONFIRM_MS = 10000;
const int OLED_SCREEN_COUNT = 6;
const int SCREEN_MAINTENANCE = 5;

// Prevent the hub from immediately fighting a local button press on the node.
unsigned long nodeButtonHoldUntil = 0;
const unsigned long NODE_BUTTON_HOLD_MS = 15000;

// Last known values from node
int lastPumpState = 0;
int lastHeaterEnabled = 0;
float lastTempF = NAN;
float lastSetpointF = NAN;
int lastETA = -1;

// Power values
float lastPumpWatts = 0.0;
float lastHeaterWatts = 0.0;
float lastKwh = 0.0;
float tempCalibrationOffsetF = 0.0;
float wattageCalibrationScale = 1.0;

// Schedule values
int pumpStartSec = -1;
int pumpStopSec = -1;
bool pumpScheduleEnabled = false;
uint8_t pumpDaysMask = 0;

int heaterStartSec = -1;
int heaterStopSec = -1;
bool heaterScheduleEnabled = false;
uint8_t heaterDaysMask = 0;

// Manual override state
bool pumpManualOverride = false;
bool heaterManualOverride = false;
int pumpManualTarget = -1;
int heaterManualTarget = -1;

// Sync helpers
bool pendingNodeSync = false;
unsigned long lastTimeSyncMillis = 0;
const unsigned long TIME_SYNC_INTERVAL_MS = 6UL * 60UL * 60UL * 1000UL; // 6 hours

// Cloud sync timers/status. These never block local pool control.
unsigned long lastCloudStateMillis = 0;
unsigned long lastCloudCommandPollMillis = 0;
unsigned long lastCloudHistoryMillis = 0;
unsigned long lastCloudScheduleSyncMillis = 0;
unsigned long lastCloudOkMillis = 0;
bool cloudOnline = false;
String lastCloudError = "";
unsigned long lastMqttReconnectMillis = 0;
unsigned long mqttNextReconnectAllowedMillis = 0;
bool mqttOnline = false;
String lastMqttCommandId = "";
bool cloudStatePushPending = false;
unsigned long cloudStatePushRequestedMillis = 0;
unsigned long lastImportantCloudStateMillis = 0;

struct QueuedMqttCommand {
  String commandId;
  String commandType;
  String payload;
  unsigned long receivedMillis = 0;
};

QueuedMqttCommand mqttCommandQueue[MQTT_COMMAND_QUEUE_SIZE];

// Boot / reconnect stabilization
unsigned long hubBootMillis = 0;
const unsigned long HUB_BOOT_GRACE_MS = 15000;
bool nodeSeenSinceBoot = false;

// Fault tracking
String currentFaultTitle = "System OK";
String currentFaultDetail = "No active faults";
String lastFaultTitle = "System OK";
String lastFaultDetail = "No recent faults";
bool currentFaultActive = false;
bool lastFaultRecovered = false;
unsigned long lastFaultMillis = 0;
time_t lastFaultUnix = 0;

// Workflow Pool Automation startup logo (64x40 monochrome OLED)
#define WORKFLOW_LOGO_WIDTH  60
#define WORKFLOW_LOGO_HEIGHT 40
const uint8_t workflowLogoBits[] PROGMEM = {
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0xC0, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xE0, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x7C, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x3F, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xC0, 0x0F, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0xE0, 0x19, 0x03, 0x02, 0x00, 0x00, 0x00, 0x00,
  0x70, 0x0C, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x38, 0x85, 0x01, 0x0C, 0x00, 0x00, 0x00, 0x00,
  0xFC, 0x81, 0x01, 0x1C, 0x00, 0x00, 0x00, 0x00, 0xFE, 0xCC, 0x01, 0x3C, 0x00, 0x00, 0x00, 0x00,
  0xFE, 0xCF, 0x30, 0x7E, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F, 0xE0, 0x7F, 0x00, 0x00, 0x00, 0x00,
  0xFF, 0x3F, 0xE0, 0x7F, 0x00, 0x00, 0x00, 0x80, 0xFF, 0x1F, 0xC0, 0xFF, 0x00, 0x00, 0x00, 0x80,
  0xFF, 0x07, 0xF0, 0xFF, 0x00, 0x00, 0x00, 0x80, 0xFF, 0x01, 0xFE, 0xFF, 0x00, 0x00, 0x00, 0x80,
  0x7F, 0x00, 0xFC, 0xFF, 0x00, 0x00, 0x00, 0x80, 0x3F, 0x00, 0x00, 0xF8, 0x01, 0x00, 0x00, 0x80,
  0x1F, 0x00, 0x3F, 0xE0, 0x01, 0x00, 0x00, 0x80, 0x1F, 0xE0, 0xFF, 0xE1, 0x01, 0x00, 0x00, 0x80,
  0x0F, 0xF8, 0xFF, 0xC3, 0x00, 0x00, 0x00, 0x80, 0x0F, 0xFC, 0xFF, 0xC3, 0x00, 0x00, 0x00, 0x80,
  0x0F, 0xFF, 0xFF, 0xC7, 0x00, 0x00, 0x00, 0x80, 0x87, 0xFF, 0xFF, 0xC7, 0x00, 0x00, 0x00, 0x00,
  0xC7, 0xFF, 0xFF, 0xC7, 0x00, 0x00, 0x00, 0x00, 0xE7, 0xFF, 0xFF, 0x67, 0x00, 0x00, 0x00, 0x00,
  0xEE, 0xFF, 0xFF, 0x63, 0x00, 0x00, 0x00, 0x00, 0xFE, 0xFF, 0xFF, 0x23, 0x00, 0x00, 0x00, 0x00,
  0xFC, 0xFF, 0xBF, 0x01, 0x00, 0x00, 0x00, 0x00, 0xF8, 0xFF, 0x9F, 0x00, 0x00, 0x00, 0x00, 0x00,
  0xF0, 0xFF, 0x4F, 0x00, 0x00, 0x00, 0x00, 0x00, 0xE0, 0xFF, 0x27, 0x00, 0x00, 0x00
};

void setRadioFlag(void) {
  radioFlag = true;
}

void IRAM_ATTR onMenuButtonInterrupt() {
  menuButtonInterruptPending = true;
}

void startListening() {
  radio.startReceive();
  radioBusyTx = false;
}

bool bootGraceActive() {
  return (millis() - hubBootMillis) < HUB_BOOT_GRACE_MS;
}

void showWorkflowSplash() {
  display.clear();
  display.setTextAlignment(TEXT_ALIGN_CENTER);

  // Slightly crop the logo width to remove the stray side artifact,
  // then center the whole splash as one group.
  const int logoX = (128 - WORKFLOW_LOGO_WIDTH) / 2;
  const int logoY = 0;
  const int workflowY = 39;
  const int subtitleY = 54;

  display.drawXbm(logoX, logoY,
                  WORKFLOW_LOGO_WIDTH, WORKFLOW_LOGO_HEIGHT,
                  workflowLogoBits);

  display.setFont(ArialMT_Plain_16);
  display.drawString(64, workflowY, "WORKFLOW");

  display.setFont(ArialMT_Plain_10);
  display.drawString(64, subtitleY, "POOL AUTOMATION");

  display.display();
}

void markFault(const String& title, const String& detail, bool activeNow = true) {
  bool changed = (currentFaultTitle != title) || (currentFaultDetail != detail) || (currentFaultActive != activeNow);

  currentFaultTitle = title;
  currentFaultDetail = detail;
  currentFaultActive = activeNow;

  if (title != "System OK") {
    if (changed || lastFaultTitle != title || lastFaultDetail != detail) {
      lastFaultTitle = title;
      lastFaultDetail = detail;
      lastFaultMillis = millis();
      time(&lastFaultUnix);
      lastFaultRecovered = false;

      Serial.print("FAULT SET: ");
      Serial.print(title);
      Serial.print(" | ");
      Serial.println(detail);
    }
  }
}

void markRecoveredIfNeeded() {
  if (!currentFaultActive && lastFaultTitle != "System OK" && !lastFaultRecovered) {
    lastFaultRecovered = true;
    Serial.print("FAULT RECOVERED: ");
    Serial.println(lastFaultTitle);
  }
}

void evaluateSystemFaults() {
  unsigned long loraAgeMs = (lastLoRaRxMillis > 0) ? (millis() - lastLoRaRxMillis) : 999999;

  if (WiFi.status() != WL_CONNECTED) {
    markFault("Wi-Fi disconnected", "Cloud/app offline", true);
    return;
  }

  if (!nodeSeenSinceBoot) {
    if (bootGraceActive()) {
      markFault("Waiting for node", "Startup in progress", true);
    } else {
      markFault("Waiting for node", "No connection yet", true);
    }
    return;
  }

  if (nodeSeenSinceBoot && loraAgeMs >= 10000) {
    markFault("Node not responding", "No LoRa packets", true);
    return;
  }

  currentFaultTitle = "System OK";
  currentFaultDetail = "No active faults";
  currentFaultActive = false;
  markRecoveredIfNeeded();
}

String formatFaultAge(unsigned long msAgo) {
  unsigned long sec = msAgo / 1000UL;
  if (sec < 60) return String(sec) + "s ago";

  unsigned long min = sec / 60UL;
  if (min < 60) return String(min) + "m ago";

  unsigned long hr = min / 60UL;
  return String(hr) + "h ago";
}

String formatClockTime(time_t t) {
  if (t <= 0) return "--";

  struct tm *tmInfo = localtime(&t);
  if (!tmInfo) return "--";

  int hour = tmInfo->tm_hour;
  int minute = tmInfo->tm_min;

  String ampm = (hour >= 12) ? "PM" : "AM";
  hour = hour % 12;
  if (hour == 0) hour = 12;

  char buf[16];
  snprintf(buf, sizeof(buf), "%d:%02d %s", hour, minute, ampm.c_str());
  return String(buf);
}

void sendPacket(const String& packet) {
  radioBusyTx = true;
  radio.startTransmit(packet.c_str());
}

void sendCommandWithAck(const String& body) {
  pendingCmdId = nextCmdId++;
  pendingBody = body;
  pendingCloudCommandId = "";
  retryCount = 0;
  awaitingAck = true;
  ackStart = millis();

  String packet = "CMD:" + String(PAIR_ID) + ":" + String(pendingCmdId) + ":" + body;

  Serial.print("TX CMD: ");
  Serial.println(packet);

  sendPacket(packet);
}

void sendCloudCommandWithAck(const String& body, const String& commandId) {
  sendCommandWithAck(body);
  pendingCloudCommandId = commandId;
}

void clearAckState() {
  awaitingAck = false;
  pendingCmdId = -1;
  pendingBody = "";
  pendingCloudCommandId = "";
  retryCount = 0;
  ackStart = 0;
}

void cancelPendingBackgroundTraffic() {
  clearAckState();
}

void sendPingNoLock() {
  if (radioBusyTx) return;

  int pingId = nextCmdId++;
  String packet = "CMD:" + String(PAIR_ID) + ":" + String(pingId) + ":PING";

  Serial.print("TX PING: ");
  Serial.println(packet);

  sendPacket(packet);
}

void retryPendingIfNeeded() {
  if (!awaitingAck || radioBusyTx) return;
  if (millis() - ackStart < ACK_TIMEOUT_MS) return;

  retryCount++;
  if (retryCount > MAX_RETRIES) {
    Serial.println("ACK FAILED");
    markFault("Command failed", "Node did not confirm", true);
    if (pendingCloudCommandId.length() > 0) {
      markCommandFailed(pendingCloudCommandId, "Node did not confirm command");
    }
    clearAckState();
    return;
  }

  ackStart = millis();

  String packet = "CMD:" + String(PAIR_ID) + ":" + String(pendingCmdId) + ":" + pendingBody;
  Serial.print("Retry TX CMD: ");
  Serial.println(packet);

  sendPacket(packet);
}

void serviceAckFailsafe() {
  if (!awaitingAck) return;
  if (millis() - ackStart <= 3000) return;

  Serial.println("FORCE RESET ACK STATE");
  clearAckState();
}

float extractFieldFloat(String msg, const String& key) {
  int start = msg.indexOf(key);
  if (start < 0) return NAN;

  start += key.length();
  int end = msg.indexOf(';', start);
  if (end < 0) end = msg.length();

  return msg.substring(start, end).toFloat();
}

int extractFieldInt(String msg, const String& key) {
  int start = msg.indexOf(key);
  if (start < 0) return -1;

  start += key.length();
  int end = msg.indexOf(';', start);
  if (end < 0) end = msg.length();

  return msg.substring(start, end).toInt();
}

// ===== Cloud/local persistence helpers =====
bool cloudConfigured() {
  return CLOUD_ENABLED &&
         String(SUPABASE_URL).startsWith("https://") &&
         String(DEVICE_ID).length() > 0 &&
         String(DEVICE_SECRET).length() > 0 &&
         String(DEVICE_SECRET) != "CHANGE_THIS_DEVICE_SECRET";
}

bool mqttConfigured() {
  return MQTT_ENABLED &&
         String(MQTT_HOST).length() > 0 &&
         String(MQTT_HOST) != "YOUR_MQTT_HOST" &&
         String(MQTT_USERNAME) != "YOUR_MQTT_USERNAME" &&
         String(MQTT_PASSWORD) != "YOUR_MQTT_PASSWORD";
}

void saveSchedulesLocally() {
  prefs.begin("poolhub", false);
  prefs.putInt("pumpStart", pumpStartSec);
  prefs.putInt("pumpStop", pumpStopSec);
  prefs.putBool("pumpSched", pumpScheduleEnabled);
  prefs.putUChar("pumpDays", pumpDaysMask);
  prefs.putInt("heatStart", heaterStartSec);
  prefs.putInt("heatStop", heaterStopSec);
  prefs.putBool("heatSched", heaterScheduleEnabled);
  prefs.putUChar("heatDays", heaterDaysMask);
  prefs.putFloat("setpoint", isnan(lastSetpointF) ? 0.0 : lastSetpointF);
  prefs.end();
}

void loadSchedulesLocally() {
  prefs.begin("poolhub", true);
  pumpStartSec = prefs.getInt("pumpStart", pumpStartSec);
  pumpStopSec = prefs.getInt("pumpStop", pumpStopSec);
  pumpScheduleEnabled = prefs.getBool("pumpSched", pumpScheduleEnabled);
  pumpDaysMask = prefs.getUChar("pumpDays", pumpDaysMask);
  heaterStartSec = prefs.getInt("heatStart", heaterStartSec);
  heaterStopSec = prefs.getInt("heatStop", heaterStopSec);
  heaterScheduleEnabled = prefs.getBool("heatSched", heaterScheduleEnabled);
  heaterDaysMask = prefs.getUChar("heatDays", heaterDaysMask);
  float savedSetpoint = prefs.getFloat("setpoint", NAN);
  if (!isnan(savedSetpoint) && savedSetpoint > 0.0) {
    lastSetpointF = savedSetpoint;
  }
  prefs.end();
}

String jsonValueRaw(const String& json, const String& key) {
  String pattern = "\"" + key + "\"";
  int keyIndex = json.indexOf(pattern);
  if (keyIndex < 0) return "";
  int colon = json.indexOf(':', keyIndex + pattern.length());
  if (colon < 0) return "";
  int start = colon + 1;
  while (start < (int)json.length() && isspace(json[start])) start++;
  if (start >= (int)json.length()) return "";

  if (json[start] == '"') {
    int end = json.indexOf('"', start + 1);
    if (end < 0) return "";
    return json.substring(start + 1, end);
  }

  int end = start;
  while (end < (int)json.length() && json[end] != ',' && json[end] != '}' && json[end] != ']') end++;
  return json.substring(start, end);
}

String jsonObjectValue(const String& json, const String& key) {
  String pattern = "\"" + key + "\"";
  int keyIndex = json.indexOf(pattern);
  if (keyIndex < 0) return "";
  int brace = json.indexOf('{', keyIndex + pattern.length());
  if (brace < 0) return "";

  int depth = 0;
  for (int i = brace; i < (int)json.length(); i++) {
    if (json[i] == '{') depth++;
    if (json[i] == '}') {
      depth--;
      if (depth == 0) return json.substring(brace, i + 1);
    }
  }
  return "";
}

int parseTimeToSeconds(const String& value) {
  int first = value.indexOf(':');
  int second = value.indexOf(':', first + 1);
  if (first < 0) return -1;
  int hours = value.substring(0, first).toInt();
  int minutes = (second > first) ? value.substring(first + 1, second).toInt() : value.substring(first + 1).toInt();
  int seconds = (second > first) ? value.substring(second + 1).toInt() : 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return -1;
  return hours * 3600 + minutes * 60 + seconds;
}

uint8_t parseDaysMask(const String& objectJson) {
  int keyIndex = objectJson.indexOf("\"days_of_week\"");
  if (keyIndex < 0) return 0;
  int open = objectJson.indexOf('[', keyIndex);
  int close = objectJson.indexOf(']', open + 1);
  if (open < 0 || close < 0) return 0;

  uint8_t mask = 0;
  String list = objectJson.substring(open + 1, close);
  int pos = 0;
  while (pos < (int)list.length()) {
    int comma = list.indexOf(',', pos);
    if (comma < 0) comma = list.length();
    int day = list.substring(pos, comma).toInt();
    if (day >= 0 && day <= 6) mask |= (1 << day);
    pos = comma + 1;
  }
  return mask;
}

String cloudUrl(const String& functionName) {
  String base = SUPABASE_URL;
  if (base.endsWith("/")) base.remove(base.length() - 1);
  return base + "/functions/v1/" + functionName;
}

bool cloudRequest(const String& method, const String& functionName, const String& body, String& response) {
  response = "";
  if (!cloudConfigured()) return false;
  if (WiFi.status() != WL_CONNECTED) {
    cloudOnline = false;
    lastCloudError = "WiFi offline";
    return false;
  }

  HTTPClient http;
  http.setTimeout(1000);
  http.begin(cloudUrl(functionName));
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_ANON_KEY);
  http.addHeader("Authorization", String("Bearer ") + SUPABASE_ANON_KEY);
  http.addHeader("x-device-id", DEVICE_ID);
  http.addHeader("x-device-secret", DEVICE_SECRET);

  int code = (method == "GET") ? http.GET() : http.POST(body);
  response = http.getString();
  http.end();

  bool ok = code >= 200 && code < 300;
  cloudOnline = ok;
  if (!ok) {
    lastCloudError = "HTTP " + String(code);
    Serial.println("Cloud request failed: " + functionName + " " + lastCloudError + " " + response);
  } else {
    lastCloudOkMillis = millis();
    lastCloudError = "";
  }
  return ok;
}

String nullableFloat(float value, int decimals = 1) {
  return isnan(value) ? String("null") : String(value, decimals);
}

String jsonEscape(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  value.replace("\n", "\\n");
  value.replace("\r", "\\r");
  return value;
}

String deviceStateJson(bool historyOnly = false) {
  String body = "{";
  body += "\"device_id\":\"" + String(DEVICE_ID) + "\"";
  body += ",\"current_temp\":" + nullableFloat(lastTempF, 1);
  body += ",\"pump_on\":" + String(lastPumpState == 1 ? "true" : "false");
  body += ",\"heater_enabled\":" + String(lastHeaterEnabled == 1 ? "true" : "false");
  body += ",\"heater_relay_on\":" + String(lastHeaterEnabled == 1 ? "true" : "false");
  body += ",\"setpoint\":" + nullableFloat(lastSetpointF, 1);
  body += ",\"pump_watts\":" + String(lastPumpWatts, 1);
  body += ",\"heater_watts\":" + String(lastHeaterWatts, 1);
  body += ",\"total_kwh\":" + String(lastKwh, 3);
  body += ",\"temp_calibration_offset\":" + String(tempCalibrationOffsetF, 1);
  body += ",\"wattage_calibration_scale\":" + String(wattageCalibrationScale, 3);
  if (!historyOnly) {
    unsigned long loraAgeMs = (lastLoRaRxMillis > 0) ? (millis() - lastLoRaRxMillis) : 999999UL;
    bool nodeOnline = nodeSeenSinceBoot && lastLoRaRxMillis > 0 && loraAgeMs < 20000UL;
    body += ",\"online_status\":\"online\"";
    body += ",\"firmware_version\":\"" + String(FIRMWARE_VERSION) + "\"";
    body += ",\"wifi_ssid\":\"" + jsonEscape(WiFi.status() == WL_CONNECTED ? WiFi.SSID() : String("")) + "\"";
    body += ",\"wifi_rssi\":" + String(WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0);
    body += ",\"lora_rssi\":" + nullableFloat(lastLoRaRssi, 1);
    body += ",\"lora_snr\":" + nullableFloat(lastLoRaSnr, 1);
    body += ",\"node_online\":" + String(nodeOnline ? "true" : "false");
    body += ",\"lora_age_seconds\":" + String(loraAgeMs / 1000UL);
  }
  body += "}";
  return body;
}

void sendDeviceStateToCloud() {
  String response;
  cloudRequest("POST", "device-state", deviceStateJson(false), response);
  lastCloudStateMillis = millis();
}

void sendHistoryToCloud() {
  String response;
  cloudRequest("POST", "device-history", deviceStateJson(true), response);
}

String mqttStateTopic() {
  return "pool/devices/" + String(DEVICE_ID) + "/state";
}

void publishMqttState() {
  if (!mqttClient.connected()) return;

  String body = deviceStateJson(false);
  mqttClient.publish(mqttStateTopic().c_str(), body.c_str(), true);
}

void requestFastStateUpdate(const String& reason) {
  publishMqttState();

  if (!cloudConfigured()) return;
  cloudStatePushPending = true;
  cloudStatePushRequestedMillis = millis();
  Serial.println("Fast state update requested: " + reason);
}

void serviceFastStateUpdate() {
  if (!cloudStatePushPending) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (awaitingAck || radioBusyTx) return;

  unsigned long now = millis();
  if (now - lastImportantCloudStateMillis < CLOUD_IMPORTANT_STATE_THROTTLE_MS) return;

  cloudStatePushPending = false;
  lastImportantCloudStateMillis = now;
  sendDeviceStateToCloud();
}

void markCommandCompleted(const String& commandId) {
  if (commandId.length() == 0) return;
  String response;
  String body = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"command_id\":\"" + commandId + "\"}";
  publishMqttState();
  sendDeviceStateToCloud();
  cloudRequest("POST", "device-command-complete", body, response);
}

void markCommandFailed(const String& commandId, const String& error) {
  if (commandId.length() == 0) return;
  String safeError = error;
  safeError.replace("\\", "\\\\");
  safeError.replace("\"", "\\\"");
  String response;
  String body = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"command_id\":\"" + commandId + "\",\"error\":\"" + safeError + "\"}";
  cloudRequest("POST", "device-command-failed", body, response);
}

bool applyScheduleObject(const String& objectJson) {
  String target = jsonValueRaw(objectJson, "target");
  int startSec = parseTimeToSeconds(jsonValueRaw(objectJson, "start_time"));
  int stopSec = parseTimeToSeconds(jsonValueRaw(objectJson, "end_time"));
  uint8_t daysMask = parseDaysMask(objectJson);
  bool enabled = jsonValueRaw(objectJson, "enabled") == "true";

  if (target != "pump" && target != "heater") return false;

  if (target == "pump") {
    pumpStartSec = startSec;
    pumpStopSec = stopSec;
    pumpDaysMask = daysMask;
    pumpScheduleEnabled = enabled && startSec >= 0 && stopSec >= 0 && startSec != stopSec;
  } else {
    heaterStartSec = startSec;
    heaterStopSec = stopSec;
    heaterDaysMask = daysMask;
    heaterScheduleEnabled = enabled && startSec >= 0 && stopSec >= 0 && startSec != stopSec;
  }
  return true;
}

bool syncSchedulesFromCloud() {
  String response;
  if (!cloudRequest("GET", "device-schedules", "", response)) return false;

  bool changed = false;
  int pos = 0;
  while (true) {
    int objectStart = response.indexOf('{', pos);
    if (objectStart < 0) break;
    int depth = 0;
    int objectEnd = -1;
    for (int i = objectStart; i < (int)response.length(); i++) {
      if (response[i] == '{') depth++;
      if (response[i] == '}') {
        depth--;
        if (depth == 0) {
          objectEnd = i;
          break;
        }
      }
    }
    if (objectEnd < 0) break;
    String objectJson = response.substring(objectStart, objectEnd + 1);
    if (objectJson.indexOf("\"target\"") >= 0) {
      changed = applyScheduleObject(objectJson) || changed;
    }
    pos = objectEnd + 1;
  }

  if (changed) {
    saveSchedulesLocally();
    requestNodeSync();
  }
  return changed;
}

bool executeCloudCommand(const String& commandId, const String& commandType, const String& payload, String& error) {
  error = "";
  if (radioBusyTx || awaitingAck) {
    error = "LoRa command channel busy";
    return false;
  }

  if (commandType == "pump_on") {
    startPumpManualOverride(1);
    lastPumpState = 1;
    cancelPendingBackgroundTraffic();
    pendingNodeSync = false;
    sendCloudCommandWithAck("PUMP_ON", commandId);
    return true;
  }

  if (commandType == "pump_off") {
    startPumpManualOverride(0);
    startHeaterManualOverride(0);
    lastPumpState = 0;
    lastHeaterEnabled = 0;
    cancelPendingBackgroundTraffic();
    pendingNodeSync = false;
    sendCloudCommandWithAck("PUMP_OFF", commandId);
    return true;
  }

  if (commandType == "heater_enable") {
    startPumpManualOverride(1);
    startHeaterManualOverride(1);
    lastPumpState = 1;
    lastHeaterEnabled = 1;
    cancelPendingBackgroundTraffic();
    pendingNodeSync = false;
    sendCloudCommandWithAck("HEATER_ON", commandId);
    return true;
  }

  if (commandType == "heater_disable") {
    startHeaterManualOverride(0);
    lastHeaterEnabled = 0;
    cancelPendingBackgroundTraffic();
    pendingNodeSync = false;
    sendCloudCommandWithAck("HEATER_OFF", commandId);
    return true;
  }

  if (commandType == "set_setpoint") {
    float setpoint = jsonValueRaw(payload, "setpoint").toFloat();
    if (setpoint <= 0.0) {
      error = "Missing setpoint";
      return false;
    }
    lastSetpointF = setpoint;
    saveSchedulesLocally();
    cancelPendingBackgroundTraffic();
    pendingNodeSync = false;
    sendCloudCommandWithAck("SET_TEMP:" + String(setpoint, 0), commandId);
    return true;
  }

  if (commandType == "set_calibration") {
    float tempOffset = jsonValueRaw(payload, "temp_offset_f").toFloat();
    float wattScale = jsonValueRaw(payload, "wattage_scale").toFloat();

    if (tempOffset < -10.0 || tempOffset > 10.0 || wattScale < 0.5 || wattScale > 1.5) {
      error = "Calibration out of range";
      return false;
    }

    tempCalibrationOffsetF = tempOffset;
    wattageCalibrationScale = wattScale;
    cancelPendingBackgroundTraffic();
    pendingNodeSync = false;
    sendCloudCommandWithAck("CAL:TEMP:" + String(tempOffset, 1) + ":WATT:" + String(wattScale, 3), commandId);
    return true;
  }

  if (commandType == "sync_schedules") {
    bool changed = syncSchedulesFromCloud();
    if (!changed && lastCloudError.length() > 0) {
      error = lastCloudError;
      return false;
    }
    markCommandCompleted(commandId);
    return true;
  }

  if (commandType == "clear_alerts") {
    currentFaultTitle = "System OK";
    currentFaultDetail = "No active faults";
    currentFaultActive = false;
    markCommandCompleted(commandId);
    return true;
  }

  if (commandType == "reboot_device") {
    markCommandCompleted(commandId);
    delay(500);
    ESP.restart();
    return true;
  }

  error = "Unsupported command";
  return false;
}

void pollCloudCommands() {
  if (awaitingAck || radioBusyTx) return;

  String response;
  if (!cloudRequest("GET", "device-command-poll", "", response)) return;

  String commandId = jsonValueRaw(response, "id");
  String commandType = jsonValueRaw(response, "command_type");
  String payload = jsonObjectValue(response, "payload");

  if (commandId.length() == 0 || commandType.length() == 0) return;

  String error;
  if (!executeCloudCommand(commandId, commandType, payload, error)) {
    markCommandFailed(commandId, error);
  }
}

String mqttCommandTopic() {
  return "pool/devices/" + String(DEVICE_ID) + "/commands";
}

String mqttAckTopic() {
  return "pool/devices/" + String(DEVICE_ID) + "/ack";
}

void publishMqttAck(const String& commandId, const String& status, const String& error = "") {
  if (!mqttClient.connected() || commandId.length() == 0) return;

  String body = "{\"device_id\":\"" + String(DEVICE_ID) + "\",\"command_id\":\"" + commandId + "\",\"status\":\"" + status + "\"";
  if (error.length() > 0) {
    String safeError = error;
    safeError.replace("\\", "\\\\");
    safeError.replace("\"", "\\\"");
    body += ",\"error\":\"" + safeError + "\"";
  }
  body += "}";

  mqttClient.publish(mqttAckTopic().c_str(), body.c_str(), false);
}

void clearQueuedMqttSlot(uint8_t slot) {
  if (slot >= MQTT_COMMAND_QUEUE_SIZE) return;
  mqttCommandQueue[slot].commandId = "";
  mqttCommandQueue[slot].commandType = "";
  mqttCommandQueue[slot].payload = "";
  mqttCommandQueue[slot].receivedMillis = 0;
}

bool queueMqttCommand(const String& commandId, const String& commandType, const String& payload) {
  for (uint8_t i = 0; i < MQTT_COMMAND_QUEUE_SIZE; i++) {
    if (mqttCommandQueue[i].commandId == commandId) return true;
  }

  for (uint8_t i = 0; i < MQTT_COMMAND_QUEUE_SIZE; i++) {
    if (mqttCommandQueue[i].commandId.length() == 0) {
      mqttCommandQueue[i].commandId = commandId;
      mqttCommandQueue[i].commandType = commandType;
      mqttCommandQueue[i].payload = payload;
      mqttCommandQueue[i].receivedMillis = millis();
      Serial.println("MQTT command queued until LoRa is free: " + commandType + " id=" + commandId);
      return true;
    }
  }

  return false;
}

void serviceQueuedMqttCommand() {
  if (radioBusyTx || awaitingAck) return;

  unsigned long now = millis();
  for (uint8_t i = 0; i < MQTT_COMMAND_QUEUE_SIZE; i++) {
    if (mqttCommandQueue[i].commandId.length() == 0) continue;

    String commandId = mqttCommandQueue[i].commandId;
    String commandType = mqttCommandQueue[i].commandType;
    String commandPayload = mqttCommandQueue[i].payload;
    unsigned long queuedAt = mqttCommandQueue[i].receivedMillis;
    clearQueuedMqttSlot(i);

    if (now - queuedAt > MQTT_COMMAND_QUEUE_TIMEOUT_MS) {
      String error = "LoRa command queue timed out";
      Serial.println("MQTT queued command timed out: " + commandType + " id=" + commandId);
      publishMqttAck(commandId, "failed", error);
      markCommandFailed(commandId, error);
      return;
    }

    String error;
    if (executeCloudCommand(commandId, commandType, commandPayload, error)) {
      publishMqttAck(commandId, "accepted");
    } else if (error == "LoRa command channel busy") {
      queueMqttCommand(commandId, commandType, commandPayload);
    } else {
      publishMqttAck(commandId, "failed", error);
      markCommandFailed(commandId, error);
    }
    return;
  }
}

void mqttCallback(char* topic, byte* payload, unsigned int length) {
  if (String(topic) != mqttCommandTopic()) return;

  String message;
  message.reserve(length + 1);
  for (unsigned int i = 0; i < length; i++) {
    message += static_cast<char>(payload[i]);
  }

  String commandId = jsonValueRaw(message, "id");
  String commandType = jsonValueRaw(message, "command_type");
  String commandPayload = jsonObjectValue(message, "payload");

  if (commandId.length() == 0 || commandType.length() == 0) {
    Serial.println("MQTT command ignored: missing id or command_type");
    return;
  }

  if (commandId == lastMqttCommandId) {
    Serial.println("MQTT duplicate command ignored: " + commandId);
    return;
  }
  lastMqttCommandId = commandId;

  Serial.println("MQTT CMD: " + commandType + " id=" + commandId);

  String error;
  if (executeCloudCommand(commandId, commandType, commandPayload, error)) {
    publishMqttAck(commandId, "accepted");
  } else if (error == "LoRa command channel busy" && queueMqttCommand(commandId, commandType, commandPayload)) {
    publishMqttAck(commandId, "queued");
  } else {
    publishMqttAck(commandId, "failed", error);
    markCommandFailed(commandId, error);
  }
}

void mqttBegin() {
  if (!mqttConfigured()) {
    Serial.println("MQTT disabled or not configured. Supabase polling remains backup.");
    return;
  }

  mqttSecureClient.setInsecure();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(mqttCallback);
  mqttClient.setBufferSize(768);
}

String mqttStateText(int state) {
  switch (state) {
    case -4: return "connection timeout";
    case -3: return "connection lost";
    case -2: return "connect failed";
    case -1: return "disconnected";
    case 1: return "bad protocol";
    case 2: return "bad client id";
    case 3: return "server unavailable";
    case 4: return "bad username/password";
    case 5: return "not authorized";
    default: return "unknown";
  }
}

void mqttLoop() {
  if (!mqttConfigured() || WiFi.status() != WL_CONNECTED) {
    mqttOnline = false;
    return;
  }

  if (mqttClient.connected()) {
    mqttOnline = true;
    mqttClient.loop();
    return;
  }

  mqttOnline = false;
  unsigned long now = millis();
  if (now < mqttNextReconnectAllowedMillis) return;
  if (now - lastMqttReconnectMillis < MQTT_RECONNECT_INTERVAL_MS) return;
  lastMqttReconnectMillis = now;

  String clientId = "pool-hub-" + String(DEVICE_ID);
  Serial.println("MQTT connecting...");
  if (mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
    mqttOnline = true;
    mqttNextReconnectAllowedMillis = 0;
    mqttClient.subscribe(mqttCommandTopic().c_str());
    publishMqttState();
    Serial.println("MQTT connected and subscribed: " + mqttCommandTopic());
  } else {
    int state = mqttClient.state();
    Serial.print("MQTT connect failed, state=");
    Serial.print(state);
    Serial.print(" (");
    Serial.print(mqttStateText(state));
    Serial.println(")");

    // Auth/permission failures are configuration issues, so avoid retry spam
    // while Supabase polling continues as the backup command path.
    if (state == 4 || state == 5) {
      mqttNextReconnectAllowedMillis = now + MQTT_AUTH_RETRY_INTERVAL_MS;
    }
  }
}

void cloudBegin() {
  loadSchedulesLocally();
  if (!cloudConfigured()) {
    Serial.println("Cloud disabled or not configured. Local control remains active.");
    return;
  }
  Serial.println("Cloud integration enabled.");
  if (WiFi.status() == WL_CONNECTED) {
    syncSchedulesFromCloud();
    sendDeviceStateToCloud();
  }
}

void cloudLoop() {
  if (!cloudConfigured()) return;
  if (WiFi.status() != WL_CONNECTED) {
    cloudOnline = false;
    return;
  }
  if (awaitingAck || radioBusyTx) return;

  unsigned long now = millis();

  serviceFastStateUpdate();

  unsigned long commandPollInterval = mqttOnline ? CLOUD_COMMAND_POLL_MQTT_ONLINE_MS : CLOUD_COMMAND_POLL_MS;
  if (now - lastCloudCommandPollMillis >= commandPollInterval) {
    lastCloudCommandPollMillis = now;
    pollCloudCommands();
  }

  if (now - lastCloudStateMillis >= CLOUD_STATE_INTERVAL_MS) {
    lastCloudStateMillis = now;
    sendDeviceStateToCloud();
  }

  if (now - lastCloudHistoryMillis >= CLOUD_HISTORY_INTERVAL_MS) {
    lastCloudHistoryMillis = now;
    sendHistoryToCloud();
  }

  if (now - lastCloudScheduleSyncMillis >= CLOUD_SCHEDULE_SYNC_MS) {
    lastCloudScheduleSyncMillis = now;
    syncSchedulesFromCloud();
  }
}

bool timeIsSynced() {
  time_t now;
  time(&now);
  return (now > 100000);
}

String formatTime12h(struct tm *timeinfo) {
  int hour = timeinfo->tm_hour;
  int minute = timeinfo->tm_min;

  String ampm = (hour >= 12) ? "PM" : "AM";

  hour = hour % 12;
  if (hour == 0) hour = 12;

  char buf[16];
  snprintf(buf, sizeof(buf), "%d:%02d %s", hour, minute, ampm.c_str());
  return String(buf);
}

String getReadyByTime(int etaMinutes) {
  if (etaMinutes <= 0) return "";

  time_t now;
  time(&now);

  if (!timeIsSynced()) return "";

  now += etaMinutes * 60;
  struct tm *futureTime = localtime(&now);
  return formatTime12h(futureTime);
}

String getWifiQuality(long rssi) {
  if (rssi == 0) return "--";
  if (rssi > -60) return "Excellent";
  if (rssi > -70) return "Good";
  if (rssi > -80) return "OK";
  return "Poor";
}

String getRssiQuality(float rssi) {
  if (isnan(rssi)) return "--";
  if (rssi > -70) return "Excellent";
  if (rssi > -85) return "Good";
  if (rssi > -100) return "OK";
  return "Poor";
}

String getSnrQuality(float snr) {
  if (isnan(snr)) return "--";
  if (snr > 8) return "Excellent";
  if (snr > 3) return "Good";
  if (snr > -2) return "OK";
  return "Poor";
}

String oledFit(String value, uint8_t maxChars) {
  if (value.length() <= maxChars) return value;
  if (maxChars <= 1) return value.substring(0, maxChars);
  return value.substring(0, maxChars - 1) + ".";
}

String formatMillisAge(unsigned long eventMillis) {
  if (eventMillis == 0) return "--";
  unsigned long ageSec = (millis() - eventMillis) / 1000UL;
  if (ageSec < 60) return String(ageSec) + "s ago";
  unsigned long ageMin = ageSec / 60UL;
  if (ageMin < 60) return String(ageMin) + "m ago";
  return String(ageMin / 60UL) + "h ago";
}

String shortMqttStatus() {
  if (!mqttConfigured()) return "Disabled";
  if (mqttOnline && mqttClient.connected()) return "Online";
  int state = mqttClient.state();
  if (state == 4) return "Bad login";
  if (state == 5) return "No auth";
  if (WiFi.status() != WL_CONNECTED) return "WiFi down";
  return "Offline";
}

void resetWiFiAndRestart() {
  Serial.println("Maintenance: resetting WiFi credentials");

  display.clear();
  display.setTextAlignment(TEXT_ALIGN_LEFT);
  display.setFont(ArialMT_Plain_10);
  display.drawString(0, 0, "RESETTING WIFI");
  display.drawString(0, 16, "Clearing saved");
  display.drawString(0, 30, "network...");
  display.drawString(0, 48, "Rebooting setup");
  display.display();

  WiFiManager wm;
  wm.resetSettings();
  WiFi.disconnect(true, true);
  delay(1200);
  ESP.restart();
}

void handleMaintenanceLongPress() {
  unsigned long now = millis();
  lastMenuActionMillis = now;

  if (wifiResetConfirmUntil > now) {
    resetWiFiAndRestart();
    return;
  }

  wifiResetConfirmUntil = now + WIFI_RESET_CONFIRM_MS;
  Serial.println("Maintenance: WiFi reset confirmation armed");
  updateDisplay();
}

void updateHeatingETAWidgets() {
  // Kept as a hook for future app/OLED ETA presentation.
}

bool isWithinScheduleWindow(int nowSec, int startSec, int stopSec) {
  if (startSec < 0 || stopSec < 0) return false;
  if (startSec == stopSec) return false;

  if (startSec < stopSec) {
    return (nowSec >= startSec && nowSec < stopSec);
  }

  return (nowSec >= startSec || nowSec < stopSec);
}

int getNowSecondsOfDay() {
  time_t now;
  time(&now);
  if (!timeIsSynced()) return -1;

  struct tm *t = localtime(&now);
  return (t->tm_hour * 3600) + (t->tm_min * 60) + t->tm_sec;
}

bool isTodayEnabled(uint8_t daysMask) {
  if (!timeIsSynced()) return false;

  time_t now;
  time(&now);
  struct tm *t = localtime(&now);

  int today = t->tm_wday;   // 0 = Sunday
  return ((daysMask >> today) & 0x01) != 0;
}

bool isDayEnabledByIndex(uint8_t daysMask, int dayIndex) {
  return ((daysMask >> dayIndex) & 0x01) != 0;
}

int secondsUntilNextScheduleEdge(int nowSec, int startSec, int stopSec, uint8_t daysMask) {
  if (!timeIsSynced()) return -1;
  if (startSec < 0 || stopSec < 0) return -1;
  if (startSec == stopSec) return -1;
  if (daysMask == 0) return -1;

  time_t now;
  time(&now);
  struct tm *t = localtime(&now);

  int today = t->tm_wday;
  int bestDelta = -1;

  for (int dayOffset = 0; dayOffset < 8; dayOffset++) {
    int checkDay = (today + dayOffset) % 7;
    if (!isDayEnabledByIndex(daysMask, checkDay)) continue;

    int dayBase = dayOffset * 86400;
    int startDelta = dayBase + (startSec - nowSec);
    int stopDelta  = dayBase + (stopSec - nowSec);

    if (dayOffset == 0) {
      if (startDelta <= 0) startDelta += 86400;
      if (stopDelta <= 0) stopDelta += 86400;
    }

    if (bestDelta < 0 || startDelta < bestDelta) bestDelta = startDelta;
    if (bestDelta < 0 || stopDelta < bestDelta) bestDelta = stopDelta;
  }

  return bestDelta;
}

void startPumpManualOverride(int targetState) {
  pumpManualOverride = true;
  pumpManualTarget = targetState;

  Serial.print("Pump manual override started, target = ");
  Serial.println(targetState);
}

void startHeaterManualOverride(int targetState) {
  heaterManualOverride = true;
  heaterManualTarget = targetState;

  Serial.print("Heater manual override started, target = ");
  Serial.println(targetState);
}

void serviceManualOverrides() {
  int nowSec = getNowSecondsOfDay();
  if (nowSec < 0) return;

  if (pumpManualOverride && pumpScheduleEnabled) {
    int delta = secondsUntilNextScheduleEdge(nowSec, pumpStartSec, pumpStopSec, pumpDaysMask);
    if (delta >= 0 && delta <= 10) {
      pumpManualOverride = false;
      pumpManualTarget = -1;
      Serial.println("Pump manual override cleared at next schedule edge");
    }
  }

  if (heaterManualOverride && heaterScheduleEnabled) {
    int delta = secondsUntilNextScheduleEdge(nowSec, heaterStartSec, heaterStopSec, heaterDaysMask);
    if (delta >= 0 && delta <= 10) {
      heaterManualOverride = false;
      heaterManualTarget = -1;
      Serial.println("Heater manual override cleared at next schedule edge");
    }
  }
}

void serviceSchedules() {
  if (awaitingAck || radioBusyTx) return;
  if (millis() < nodeButtonHoldUntil) return;

  serviceManualOverrides();

  int nowSec = getNowSecondsOfDay();
  if (nowSec < 0) return;

  bool pumpScheduledState = false;
  bool heaterScheduledState = false;

  if (pumpScheduleEnabled && isTodayEnabled(pumpDaysMask)) {
    pumpScheduledState = isWithinScheduleWindow(nowSec, pumpStartSec, pumpStopSec);
  }

  if (heaterScheduleEnabled && isTodayEnabled(heaterDaysMask)) {
    heaterScheduledState = isWithinScheduleWindow(nowSec, heaterStartSec, heaterStopSec);
  }

  bool pumpDesired = pumpManualOverride ? (pumpManualTarget == 1) : pumpScheduledState;
  bool heaterDesired = heaterManualOverride ? (heaterManualTarget == 1) : heaterScheduledState;

  if (pumpManualOverride && pumpManualTarget == 0) {
    heaterDesired = false;
  }

  if (heaterDesired) {
    pumpDesired = true;
  }

  if (pumpDesired != (lastPumpState == 1)) {
    Serial.println(pumpDesired ? "Control -> PUMP_ON" : "Control -> PUMP_OFF");
    sendCommandWithAck(pumpDesired ? "PUMP_ON" : "PUMP_OFF");
    return;
  }

  if (heaterDesired != (lastHeaterEnabled == 1)) {
    Serial.println(heaterDesired ? "Control -> HEATER_ON" : "Control -> HEATER_OFF");
    sendCommandWithAck(heaterDesired ? "HEATER_ON" : "HEATER_OFF");
    return;
  }
}

void sendPumpScheduleToNode() {
  String body = "CFG:PUMP:" + String(pumpStartSec) + ":" + String(pumpStopSec) + ":" +
                String((int)pumpDaysMask) + ":" + String(pumpScheduleEnabled ? 1 : 0);
  sendCommandWithAck(body);
}

void sendHeaterScheduleToNode() {
  String body = "CFG:HEATER:" + String(heaterStartSec) + ":" + String(heaterStopSec) + ":" +
                String((int)heaterDaysMask) + ":" + String(heaterScheduleEnabled ? 1 : 0);
  sendCommandWithAck(body);
}

void sendTimeToNode() {
  if (!timeIsSynced()) {
    Serial.println("Time sync skipped: hub time not ready");
    return;
  }

  time_t now;
  time(&now);
  struct tm *lt = localtime(&now);

  String body = "CFG:TIMEPARTS:" +
                String(lt->tm_year + 1900) + ":" +
                String(lt->tm_mon + 1) + ":" +
                String(lt->tm_mday) + ":" +
                String(lt->tm_hour) + ":" +
                String(lt->tm_min) + ":" +
                String(lt->tm_sec);

  sendCommandWithAck(body);
}

void requestNodeSync() {
  pendingNodeSync = true;
}

void serviceNodeSyncQueue() {
  if (bootGraceActive()) return;
  if (!pendingNodeSync) return;
  if (awaitingAck || radioBusyTx) return;

  static int syncStep = 0;

  if (syncStep == 0) {
    if (timeIsSynced()) {
      Serial.println("Sync step 1/3 -> TIMEPARTS");
      sendTimeToNode();
      syncStep = 1;
      return;
    }
    syncStep = 1;
  }

  if (syncStep == 1) {
    Serial.println("Sync step 2/3 -> PUMP schedule");
    sendPumpScheduleToNode();
    syncStep = 2;
    return;
  }

  if (syncStep == 2) {
    Serial.println("Sync step 3/3 -> HEATER schedule");
    sendHeaterScheduleToNode();
    syncStep = 0;
    pendingNodeSync = false;
    return;
  }
}

void servicePeriodicTimeSync() {
  if (bootGraceActive()) return;
  if (!timeIsSynced()) return;
  if (awaitingAck || radioBusyTx) return;
  if (millis() - lastTimeSyncMillis < TIME_SYNC_INTERVAL_MS) return;

  lastTimeSyncMillis = millis();
  Serial.println("Periodic RTC sync -> node");
  sendTimeToNode();
}

void serviceHubPing() {
  if (bootGraceActive()) return;
  if (radioBusyTx) return;
  if (pendingNodeSync) return;
  if (millis() - lastPingMillis < PING_INTERVAL_MS) return;

  lastPingMillis = millis();
  sendPingNoLock();
}

void setupMenuButton() {
  pinMode(MENU_BUTTON_PIN, INPUT_PULLUP);
  lastButtonReading = digitalRead(MENU_BUTTON_PIN);
  stableButtonState = lastButtonReading;
  menuButtonPressLatched = false;
  menuButtonDown = false;
  menuLongPressHandled = false;
  menuShortPressHandled = false;
  menuButtonDownMillis = 0;
  wifiResetConfirmUntil = 0;
  lastMenuActionMillis = millis();
  lastAcceptedMenuPressMillis = 0;
  attachInterrupt(digitalPinToInterrupt(MENU_BUTTON_PIN), onMenuButtonInterrupt, FALLING);
}

void advanceMenuScreen() {
  currentScreen++;
  if (currentScreen >= OLED_SCREEN_COUNT) currentScreen = 0;
  wifiResetConfirmUntil = 0;

  lastMenuActionMillis = millis();

  Serial.print("Screen changed to: ");
  Serial.println(currentScreen);

  updateDisplay();
}

void serviceMenuButton() {
  if (menuButtonInterruptPending) {
    noInterrupts();
    menuButtonInterruptPending = false;
    interrupts();
  }

  unsigned long now = millis();
  bool reading = digitalRead(MENU_BUTTON_PIN);

  if (reading != lastButtonReading) {
    lastDebounceTime = now;
  }

  bool debouncedPress = false;
  bool debouncedRelease = false;
  if ((now - lastDebounceTime) > BUTTON_DEBOUNCE_MS) {
    if (reading != stableButtonState) {
      stableButtonState = reading;

      if (stableButtonState == LOW) {
        debouncedPress = true;
      } else {
        debouncedRelease = true;
      }
    }
  }

  lastButtonReading = reading;

  if (debouncedPress) {
    bool pressedOnMaintenance = (currentScreen == SCREEN_MAINTENANCE);

    menuButtonDown = true;
    menuButtonPressLatched = true;
    menuLongPressHandled = false;
    menuShortPressHandled = false;
    menuButtonDownMillis = now;
    lastMenuActionMillis = now;

    if (!pressedOnMaintenance && (now - lastAcceptedMenuPressMillis >= MENU_PRESS_GUARD_MS)) {
      lastAcceptedMenuPressMillis = now;
      menuShortPressHandled = true;
      advanceMenuScreen();
    }
  }

  if (menuButtonDown &&
      stableButtonState == LOW &&
      !menuLongPressHandled &&
      currentScreen == SCREEN_MAINTENANCE &&
      now - menuButtonDownMillis >= MENU_LONG_PRESS_MS) {
    menuLongPressHandled = true;
    handleMaintenanceLongPress();
  }

  if (debouncedRelease) {
    menuButtonPressLatched = false;

    if (menuButtonDown) {
      bool guardPassed = (now - lastAcceptedMenuPressMillis >= MENU_PRESS_GUARD_MS);
      if (!menuLongPressHandled && !menuShortPressHandled && guardPassed) {
        lastAcceptedMenuPressMillis = now;
        advanceMenuScreen();
      }
    }

    menuButtonDown = false;
    menuShortPressHandled = false;
  }

  if (currentScreen != 0 && (now - lastMenuActionMillis >= MENU_TIMEOUT_MS)) {
    currentScreen = 0;
    wifiResetConfirmUntil = 0;
    Serial.println("Menu timeout -> returning to main screen");
    updateDisplay();
  }
}

void updateDisplay() {
  display.clear();
  display.setTextAlignment(TEXT_ALIGN_LEFT);
  display.setFont(ArialMT_Plain_10);

  unsigned long loraAgeMs = (lastLoRaRxMillis > 0) ? (millis() - lastLoRaRxMillis) : 999999;
  unsigned long loraAgeSec = loraAgeMs / 1000;

  if (currentScreen == 0) {
    display.drawString(0, 0, "POOL HUB");

    String wifiStatus = (WiFi.status() == WL_CONNECTED) ? "Connected" : "Offline";
    display.drawString(0, 14, "WiFi: " + wifiStatus);

    String loraStatus;
    if (!nodeSeenSinceBoot) {
      loraStatus = bootGraceActive() ? "STARTING" : "WAITING";
    } else {
      loraStatus = (lastLoRaRxMillis > 0 && loraAgeMs < 10000) ? "OK" : "LOST";
    }
    display.drawString(0, 28, "LoRa: " + loraStatus);

    if (!isnan(lastTempF) && lastLoRaRxMillis > 0 && loraAgeMs < 30000) {
      display.drawString(0, 42, "Temp: " + String(lastTempF, 1) + " F");
    } else {
      display.drawString(0, 42, "Temp: --");
    }
  }
  else if (currentScreen == 1) {
    display.drawString(0, 0, "WIFI INFO");

    if (WiFi.status() == WL_CONNECTED) {
      display.drawString(0, 14, "Quality: " + getWifiQuality(WiFi.RSSI()));
      display.drawString(0, 28, "Network:");
      display.drawString(0, 42, WiFi.SSID());
    } else {
      display.drawString(0, 14, "Quality: --");
      display.drawString(0, 28, "Network:");
      display.drawString(0, 42, "Not connected");
    }
  }
  else if (currentScreen == 2) {
    display.drawString(0, 0, "LORA INFO");

    bool loraLinked = nodeSeenSinceBoot && (lastLoRaRxMillis > 0) && (loraAgeMs < 10000);

    if (lastLoRaRxMillis > 0) {
      display.drawString(0, 12, "LoRa age: " + String(loraAgeSec) + " s");
    } else if (bootGraceActive()) {
      display.drawString(0, 12, "LoRa age: booting");
    } else {
      display.drawString(0, 12, "LoRa age: --");
    }

    if (!nodeSeenSinceBoot) {
      display.drawString(0, 26, "LoRa Signal: ...");
      display.drawString(0, 40, "LoRa S. Quality:");
      display.drawString(0, 52, "...");
    } else if (!loraLinked) {
      display.drawString(0, 26, "LoRa Signal: LOST");
      display.drawString(0, 40, "LoRa S. Quality:");
      display.drawString(0, 52, "LOST");
    } else {
      if (!isnan(lastLoRaRssi)) {
        display.drawString(0, 26, "LoRa Signal: " + getRssiQuality(lastLoRaRssi));
      } else {
        display.drawString(0, 26, "LoRa Signal: --");
      }

      if (!isnan(lastLoRaSnr)) {
        display.drawString(0, 40, "LoRa S. Quality:");
        display.drawString(0, 52, getSnrQuality(lastLoRaSnr));
      } else {
        display.drawString(0, 40, "LoRa S. Quality:");
        display.drawString(0, 52, "--");
      }
    }
  }
  else if (currentScreen == 3) {
    display.drawString(0, 0, "LAST FAULT");
    display.drawString(0, 14, lastFaultTitle);

    bool blinkOn = ((millis() / 1000) % 2) == 0;
    unsigned long ageSec = (millis() - lastFaultMillis) / 1000UL;
    bool veryRecentFault = currentFaultActive && (lastFaultTitle == currentFaultTitle) && (ageSec < 10);

    if (!nodeSeenSinceBoot && lastFaultTitle == "Waiting for node") {
      display.drawString(0, 28, lastFaultDetail);
      display.drawString(0, 42, "...");
    }
    else if (lastFaultTitle == "System OK") {
      display.drawString(0, 28, "No active faults");
      display.drawString(0, 42, "No recent faults");
    }
    else {
      if (veryRecentFault) {
        display.drawString(0, 28, String(ageSec) + "s ago");
      } else {
        display.drawString(0, 28, formatClockTime(lastFaultUnix));
      }

      if (currentFaultActive && lastFaultTitle == currentFaultTitle) {
        if (blinkOn) {
          display.drawString(0, 42, "Active problem");
        }
      } else if (lastFaultRecovered) {
        display.drawString(0, 42, "✓ Recovered");
      } else {
        display.drawString(0, 42, formatFaultAge(millis() - lastFaultMillis));
      }
    }
  }
  else if (currentScreen == 4) {
    display.drawString(0, 0, "CLOUD LINK");

    String cloudStatus;
    if (!cloudConfigured()) {
      cloudStatus = "Disabled";
    } else if (WiFi.status() != WL_CONNECTED) {
      cloudStatus = "WiFi down";
    } else {
      cloudStatus = cloudOnline ? "Online" : "Offline";
    }

    display.drawString(0, 12, String("Supabase: ") + cloudStatus);
    display.drawString(0, 24, String("MQTT: ") + shortMqttStatus());

    if (WiFi.status() == WL_CONNECTED) {
      display.drawString(0, 36, String("RSSI: ") + String(WiFi.RSSI()) + " " + getWifiQuality(WiFi.RSSI()));
    } else {
      display.drawString(0, 36, "RSSI: --");
    }

    if (lastCloudOkMillis > 0) {
      display.drawString(0, 50, String("Last OK: ") + formatMillisAge(lastCloudOkMillis));
    } else if (lastCloudError.length() > 0) {
      display.drawString(0, 50, oledFit(String("Err: ") + lastCloudError, 21));
    } else {
      display.drawString(0, 50, "Last OK: --");
    }
  }
  else if (currentScreen == SCREEN_MAINTENANCE) {
    display.drawString(0, 0, "MAINTENANCE");
    display.drawString(0, 12, oledFit(String("FW: ") + String(FIRMWARE_VERSION), 21));
    display.drawString(0, 24, oledFit(String("ID: ") + String(DEVICE_ID), 21));

    if (wifiResetConfirmUntil > millis()) {
      display.drawString(0, 38, "Confirm reset:");
      display.drawString(0, 50, "Hold 3s again");
    } else {
      display.drawString(0, 38, "Hold 3s:");
      display.drawString(0, 50, "Reset WiFi");
    }
  }

  display.display();
}

void updateStateFromMessage(String msg) {
  int oldPumpState = lastPumpState;
  int oldHeaterEnabled = lastHeaterEnabled;
  float oldSetpointF = lastSetpointF;
  float oldTempCalibrationOffsetF = tempCalibrationOffsetF;
  float oldWattageCalibrationScale = wattageCalibrationScale;

  int pump = extractFieldInt(msg, "PUMP:");
  int heater = extractFieldInt(msg, "HEATER:");
  float tempF = extractFieldFloat(msg, "TEMP:");
  float setpointF = extractFieldFloat(msg, "SET:");
  float tempOffset = extractFieldFloat(msg, "TOFF:");
  float wattScale = extractFieldFloat(msg, "WSCALE:");
  int eta = extractFieldInt(msg, "ETA:");

  if (pump != -1) {
    lastPumpState = pump;
  }

  if (heater != -1) {
    lastHeaterEnabled = heater;
  }

  if (!isnan(tempF)) {
    lastTempF = tempF;
  }

  if (!isnan(setpointF)) {
    lastSetpointF = setpointF;
  }

  if (!isnan(tempOffset)) {
    tempCalibrationOffsetF = tempOffset;
  }

  if (!isnan(wattScale)) {
    wattageCalibrationScale = wattScale;
  }

  lastETA = (eta != -1) ? eta : -1;

  float pumpW = extractFieldFloat(msg, "PUMPW:");
  float heaterW = extractFieldFloat(msg, "HEATERW:");
  float kwh = extractFieldFloat(msg, "KWH:");

  if (!isnan(pumpW)) {
    lastPumpWatts = pumpW;
  }

  if (!isnan(heaterW)) {
    lastHeaterWatts = heaterW;
  }

  if (!isnan(kwh)) {
    lastKwh = kwh;
  }

  updateHeatingETAWidgets();

  bool setpointChanged = (isnan(oldSetpointF) != isnan(lastSetpointF)) ||
                         (!isnan(oldSetpointF) && !isnan(lastSetpointF) && fabs(oldSetpointF - lastSetpointF) >= 0.1);
  bool calibrationChanged = fabs(oldTempCalibrationOffsetF - tempCalibrationOffsetF) >= 0.1 ||
                            fabs(oldWattageCalibrationScale - wattageCalibrationScale) >= 0.001;
  if (oldPumpState != lastPumpState || oldHeaterEnabled != lastHeaterEnabled || setpointChanged || calibrationChanged) {
    requestFastStateUpdate("node state changed");
  }

  String shortStatus = "Pump " + String(lastPumpState ? "ON" : "OFF") +
                       " | Heater " + String(lastHeaterEnabled ? "ON" : "OFF");

  if (!isnan(lastTempF)) {
    shortStatus += " | Temp " + String(lastTempF, 1) + "F";
  }

  Serial.println("STATE: " + shortStatus);
}

void handleButtonEvent(String msg) {
  Serial.print("BTN EVENT RX: ");
  Serial.println(msg);

  if (!msg.startsWith("BTN:" + String(PAIR_ID) + ":")) {
    Serial.println("Ignored BTN with wrong PAIR_ID");
    return;
  }

  nodeButtonHoldUntil = millis() + NODE_BUTTON_HOLD_MS;

  if (msg.startsWith("BTN:" + String(PAIR_ID) + ":PUMP:")) {
    int state = msg.substring((String("BTN:") + PAIR_ID + ":PUMP:").length()).toInt();

    startPumpManualOverride(state);
    if (state == 0) {
      startHeaterManualOverride(0);
      lastHeaterEnabled = 0;
    }
    lastPumpState = state;
    Serial.println(String("Node button: pump ") + (state ? "ON" : "OFF"));
    updateHeatingETAWidgets();
    requestFastStateUpdate("node pump button");
    return;
  }

  if (msg.startsWith("BTN:" + String(PAIR_ID) + ":HEATER:")) {
    int state = msg.substring((String("BTN:") + PAIR_ID + ":HEATER:").length()).toInt();

    startHeaterManualOverride(state);
    lastHeaterEnabled = state;

    if (state) {
      startPumpManualOverride(1);
      lastPumpState = 1;
    }

    Serial.println(String("Node button: heater ") + (state ? "ON" : "OFF"));
    updateHeatingETAWidgets();
    requestFastStateUpdate("node heater button");
  }
}

void handleReceived(String msg) {
  bool isBtn = msg.startsWith("BTN:");
  bool isAck = msg.startsWith("ACK:");
  bool isStat = msg.startsWith("STAT:");

  if (!isBtn && !isAck && !isStat) return;

  if (isBtn) {
    if (!msg.startsWith("BTN:" + String(PAIR_ID) + ":")) {
      Serial.println("Ignored BTN with wrong PAIR_ID");
      return;
    }
    lastLoRaRxMillis = millis();
    nodeSeenSinceBoot = true;
    handleButtonEvent(msg);
    return;
  }

  if (isAck && !msg.startsWith("ACK:" + String(PAIR_ID) + ":")) {
    Serial.println("Ignored ACK with wrong PAIR_ID");
    return;
  }

  if (isStat && !msg.startsWith("STAT:" + String(PAIR_ID) + ";")) {
    Serial.println("Ignored STAT with wrong PAIR_ID");
    return;
  }

  lastLoRaRxMillis = millis();
  nodeSeenSinceBoot = true;

  Serial.print("RX: ");
  Serial.println(msg);

  String completedCloudCommandId = "";
  bool shouldClearAckState = false;

  if (isAck) {
    int ackStartIndex = String("ACK:").length() + String(PAIR_ID).length() + 1;
    int semi = msg.indexOf(';', ackStartIndex);
    if (semi > ackStartIndex) {
      int ackId = msg.substring(ackStartIndex, semi).toInt();

      if (awaitingAck) {
        if (ackId == pendingCmdId) {
          Serial.println("ACK matched");
        } else {
          Serial.print("ACK mismatch but clearing anyway. pending=");
          Serial.print(pendingCmdId);
          Serial.print(" rx=");
          Serial.println(ackId);
        }
        if (pendingCloudCommandId.length() > 0) {
          completedCloudCommandId = pendingCloudCommandId;
        }
        shouldClearAckState = true;
      }
    }
  }

  lastReply = msg;
  updateStateFromMessage(msg);

  if (shouldClearAckState) {
    clearAckState();
  }

  if (completedCloudCommandId.length() > 0) {
    markCommandCompleted(completedCloudCommandId);
  }
}

void serviceRadio() {
  if (!radioFlag) return;

  radioFlag = false;

  if (radioBusyTx) {
    radio.finishTransmit();
    startListening();
    return;
  }

  radio.finishReceive();

  static uint8_t buf[280];
  size_t len = radio.getPacketLength();

  if (len > 0) {
    if (len > sizeof(buf) - 1) len = sizeof(buf) - 1;
    radio.readData(buf, len);
    buf[len] = 0;

    lastLoRaRssi = radio.getRSSI();
    lastLoRaSnr  = radio.getSNR();

    handleReceived((char*)buf);
  }

  startListening();
}

void connectWiFiSafely() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin();

  Serial.println("Trying saved WiFi...");
  unsigned long start = millis();

  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Saved WiFi connected");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    return;
  }

  Serial.println("Saved WiFi failed, starting WiFiManager portal...");

  WiFiManager wm;
  wm.setConfigPortalTimeout(180);
  wm.setConnectTimeout(20);
  wm.setWiFiAutoReconnect(true);
  wm.setBreakAfterConfig(true);

  bool ok = wm.startConfigPortal("POOL-HUB-SETUP");

  if (ok) {
    Serial.println("WiFiManager connected");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFiManager failed or timed out");
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  hubBootMillis = millis();

  pinMode(36, OUTPUT);
  digitalWrite(36, LOW);
  delay(50);

  pinMode(21, OUTPUT);
  digitalWrite(21, LOW);
  delay(20);
  digitalWrite(21, HIGH);
  delay(20);

  Wire.begin(17, 18);
  delay(50);

  display.init();
  display.flipScreenVertically();

  showWorkflowSplash();
  delay(3000);

  display.clear();
  display.setTextAlignment(TEXT_ALIGN_LEFT);
  display.setFont(ArialMT_Plain_10);
  display.drawString(0, 0, "POOL HUB BOOTING...");
  display.display();
  delay(1000);

  setupMenuButton();
  connectWiFiSafely();

  if (WiFi.status() == WL_CONNECTED) {
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    setenv("TZ", "EST5EDT,M3.2.0/2,M11.1.0/2", 1);
    tzset();
  } else {
    Serial.println("Skipping time sync because WiFi is not connected");
  }

  mqttBegin();
  cloudBegin();

  SPI.begin();
  int state = radio.begin(915.0, 250.0, 7, 5);

  if (state != RADIOLIB_ERR_NONE) {
    Serial.print("LoRa init failed, code: ");
    Serial.println(state);

    display.clear();
    display.drawString(0, 0, "POOL HUB");
    display.drawString(0, 16, "LoRa init failed");
    display.drawString(0, 32, "Code: " + String(state));
    display.display();

    while (true) {
      delay(1000);
    }
  }

  radio.setDio1Action(setRadioFlag);
  startListening();

  timer.setInterval(50L, retryPendingIfNeeded);
  timer.setInterval(500L, serviceAckFailsafe);
  timer.setInterval(1000L, serviceSchedules);
  timer.setInterval(1000L, updateDisplay);
  timer.setInterval(300L, serviceNodeSyncQueue);
  timer.setInterval(60000L, servicePeriodicTimeSync);
  timer.setInterval(1000L, serviceHubPing);
  timer.setInterval(1000L, evaluateSystemFaults);

  evaluateSystemFaults();
  updateDisplay();
}

void loop() {
  serviceMenuButton();
  serviceRadio();
  serviceQueuedMqttCommand();
  mqttLoop();
  serviceQueuedMqttCommand();
  timer.run();
  cloudLoop();
}

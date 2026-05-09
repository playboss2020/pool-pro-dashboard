import mqtt, { type MqttClient } from "mqtt";
import { defaultDeviceId, deviceId } from "./supabase";

const directMqttEnabled = import.meta.env.VITE_MQTT_DIRECT_ENABLED === "true";
const mqttWsUrl = import.meta.env.VITE_MQTT_WS_URL?.trim() ?? "";
const mqttUsername = import.meta.env.VITE_MQTT_USERNAME?.trim() ?? "";
const mqttPassword = import.meta.env.VITE_MQTT_PASSWORD?.trim() ?? "";
const mqttCommandTopic = resolveDeviceTopic(import.meta.env.VITE_MQTT_COMMAND_TOPIC?.trim() ?? "", "commands");
const mqttStateTopic = resolveDeviceTopic(import.meta.env.VITE_MQTT_STATE_TOPIC?.trim() ?? "", "state");

let cachedClient: MqttClient | null = null;
let connectPromise: Promise<MqttClient> | null = null;

export type DirectMqttCommand = {
  id: string;
  command_type: string;
  payload: Record<string, unknown>;
  created_at: string;
};

function resolveDeviceTopic(configuredTopic: string, suffix: "commands" | "state") {
  const dynamicTopic = `pool/devices/${deviceId}/${suffix}`;
  if (!configuredTopic) return dynamicTopic;
  if (configuredTopic.includes("{deviceId}")) return configuredTopic.replace(/\{deviceId\}/g, deviceId);

  const defaultTopic = `pool/devices/${defaultDeviceId}/${suffix}`;
  return deviceId === defaultDeviceId || configuredTopic !== defaultTopic ? configuredTopic : dynamicTopic;
}

export function isDirectMqttConfigured() {
  return directMqttEnabled && Boolean(mqttWsUrl && mqttUsername && mqttPassword);
}

function getMqttClient() {
  if (!isDirectMqttConfigured()) {
    return Promise.reject(new Error("Direct MQTT is not configured"));
  }

  if (cachedClient?.connected) {
    return Promise.resolve(cachedClient);
  }

  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve, reject) => {
    const client = mqtt.connect(mqttWsUrl, {
      username: mqttUsername,
      password: mqttPassword,
      clean: true,
      keepalive: 30,
      reconnectPeriod: 1500,
      connectTimeout: 2500,
      clientId: `pool-app-${deviceId}-${Math.random().toString(16).slice(2)}`,
      protocolVersion: 4,
    });

    const timeout = window.setTimeout(() => {
      client.end(true);
      connectPromise = null;
      reject(new Error("MQTT connection timed out"));
    }, 3200);

    client.once("connect", () => {
      window.clearTimeout(timeout);
      cachedClient = client;
      connectPromise = null;
      resolve(client);
    });

    client.once("error", (error) => {
      window.clearTimeout(timeout);
      cachedClient = null;
      connectPromise = null;
      client.end(true);
      reject(error);
    });

    client.on("close", () => {
      if (cachedClient === client && !client.reconnecting) {
        cachedClient = null;
      }
    });
  });

  return connectPromise;
}

export async function publishDirectMqttCommand(command: DirectMqttCommand) {
  const client = await getMqttClient();
  const body = JSON.stringify(command);

  await new Promise<void>((resolve, reject) => {
    client.publish(mqttCommandTopic, body, { qos: 0, retain: false }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function subscribeDirectMqttState(onMessage: (payload: string) => void) {
  if (!isDirectMqttConfigured()) return () => {};

  let active = true;
  let clientForCleanup: MqttClient | null = null;
  let subscribed = false;

  const handleMessage = (topic: string, payload: Uint8Array) => {
    if (topic !== mqttStateTopic) return;
    onMessage(new TextDecoder().decode(payload));
  };

  void getMqttClient()
    .then((client) => {
      if (!active) return;
      clientForCleanup = client;
      client.on("message", handleMessage);
      client.subscribe(mqttStateTopic, { qos: 0 }, (error) => {
        if (!error) subscribed = true;
      });
    })
    .catch((error) => {
      console.warn("Direct MQTT state subscribe failed", error);
    });

  return () => {
    active = false;
    if (!clientForCleanup) return;
    clientForCleanup.off("message", handleMessage);
    if (subscribed) {
      clientForCleanup.unsubscribe(mqttStateTopic);
    }
  };
}

import hubFirmwareTemplate from "../firmware/PoolHubSupabase.template.ino?raw";
import type { WorkflowAdminRegisterDeviceResponse } from "./deviceApi";

function escapeForCppString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function serialConstantLine(serialNumber: string) {
  return `constexpr char DEVICE_SERIAL_NUMBER[] = "${escapeForCppString(serialNumber)}";`;
}

function replaceDefineString(source: string, name: string, value: string) {
  const escaped = escapeForCppString(value);
  const definePattern = new RegExp(`^#define\\s+${name}\\s+".*?"$`, "m");
  const constexprPattern = new RegExp(`^constexpr\\s+char\\s+${name}\\[\\]\\s*=\\s*".*?";$`, "m");

  if (definePattern.test(source)) {
    return source.replace(definePattern, `#define ${name} "${escaped}"`);
  }

  if (constexprPattern.test(source)) {
    return source.replace(constexprPattern, `constexpr char ${name}[] = "${escaped}";`);
  }

  return `#define ${name} "${escaped}"\n${source}`;
}

export function pairIdForDevice(result: WorkflowAdminRegisterDeviceResponse) {
  const serialDigits = result.firmware.serial_number.match(/(\d+)$/)?.[1];
  if (serialDigits) return `POOL_${serialDigits.slice(-6).padStart(6, "0")}`;

  const deviceDigits = result.firmware.device_id.match(/(\d+)$/)?.[1];
  if (deviceDigits) return `POOL_${deviceDigits.slice(-6).padStart(6, "0")}`;

  return result.firmware.device_id
    .toUpperCase()
    .replace(/^POOL[-_]?HUB[-_]?/, "POOL_")
    .replace(/[^A-Z0-9_]/g, "_")
    .slice(0, 24);
}

export function generateHubFirmware(
  result: WorkflowAdminRegisterDeviceResponse,
  template = hubFirmwareTemplate,
) {
  const deviceId = escapeForCppString(result.firmware.device_id);
  const deviceSecret = escapeForCppString(result.firmware.device_secret);
  const serialNumber = escapeForCppString(result.firmware.serial_number);
  const setupCode = result.firmware.claim_code ? escapeForCppString(result.firmware.claim_code) : "";
  const pairId = pairIdForDevice(result);

  let output = replaceDefineString(template, "PAIR_ID", pairId)
    .replace(
      /^constexpr char DEVICE_ID\[\] = ".*?";$/m,
      `constexpr char DEVICE_ID[] = "${deviceId}";`,
    )
    .replace(
      /^constexpr char DEVICE_SECRET\[\] = ".*?";$/m,
      `constexpr char DEVICE_SECRET[] = "${deviceSecret}";`,
    );

  if (/^constexpr char DEVICE_SERIAL_NUMBER\[\] = ".*?";$/m.test(output)) {
    output = output.replace(
      /^constexpr char DEVICE_SERIAL_NUMBER\[\] = ".*?";$/m,
      serialConstantLine(serialNumber),
    );
  } else {
    output = output.replace(
      /^constexpr char DEVICE_SECRET\[\] = ".*?";$/m,
      `constexpr char DEVICE_SECRET[] = "${deviceSecret}";\n${serialConstantLine(serialNumber)}`,
    );
  }

  const setupCodeLine = setupCode
    ? `// Customer setup code for app claim: ${setupCode}`
    : "// Customer setup code for app claim: none";

  if (!output.includes("// Customer setup code for app claim:")) {
    output = output.replace(
      /^constexpr char DEVICE_SERIAL_NUMBER\[\] = ".*?";$/m,
      `${serialConstantLine(serialNumber)}\n${setupCodeLine}`,
    );
  }

  return output;
}

export function generateNodeFirmware(
  result: WorkflowAdminRegisterDeviceResponse,
  template: string,
) {
  const pairId = pairIdForDevice(result);
  const serialNumber = result.firmware.serial_number;
  const nodeSerialNumber = `${serialNumber}-NODE`;

  let output = replaceDefineString(template, "PAIR_ID", pairId);
  output = replaceDefineString(output, "DEVICE_SERIAL_NUMBER", serialNumber);
  output = replaceDefineString(output, "NODE_SERIAL_NUMBER", nodeSerialNumber);

  if (!output.includes("// Workflow generated pair values")) {
    output = [
      "// Workflow generated pair values",
      `// Hub/device ID: ${result.firmware.device_id}`,
      `// Pair ID: ${pairId}`,
      output,
    ].join("\n");
  }

  return output;
}

export function downloadTextFile(fileName: string, contents: string) {
  const blob = new Blob([contents], { type: "text/x-arduino;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function hubFirmwareFileName(result: WorkflowAdminRegisterDeviceResponse) {
  const cleanId = result.firmware.device_id.replace(/[^a-z0-9_-]/gi, "_");
  return `WorkflowPoolHub_${cleanId}.ino`;
}

export function nodeFirmwareFileName(result: WorkflowAdminRegisterDeviceResponse) {
  const cleanId = result.firmware.device_id.replace(/[^a-z0-9_-]/gi, "_");
  return `WorkflowPoolNode_${cleanId}.ino`;
}

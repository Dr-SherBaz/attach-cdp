export { run, main, parseArgv, UsageError } from "./cli.js";

export {
  Connection,
  CdpError,
  version,
  listTargets,
  attach,
  evaluate,
  innerText,
  screenshot,
  navigate,
  pdf,
  createTarget,
  closeTarget,
  waitFor,
  click,
} from "./cdp.js";

export { matchTarget, describeTargets, TargetNotFoundError } from "./match.js";

export {
  EndpointError,
  candidateProfileDirs,
  parseDevToolsActivePort,
  readEndpointFromDir,
  discoverLocalEndpoint,
  resolveEndpoint,
  resolveFromPort,
} from "./endpoint.js";

export { runMcpBridge, buildBridgeCommand, DEFAULT_MCP_PACKAGE } from "./mcp-bridge.js";

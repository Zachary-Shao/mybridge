import { Agent } from "./agent.js";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--no-discovery") {
      options.enableDiscovery = false;
      continue;
    }
    if (argument.startsWith("--")) {
      const key = argument.slice(2);
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${argument}`);
      }
      options[key.replaceAll("-", "")] = value;
      index += 1;
    }
  }
  return options;
}

function showHelp() {
  console.log(`MyBridge 0.1.0\n\nUsage:\n  npm start -- [options]\n\nOptions:\n  --name <name>          Device name shown on the LAN\n  --port <port>          Local HTTP console port (default: 39875)\n  --udp-port <port>      Discovery UDP port (default: 39876)\n  --data-dir <path>      Override local config directory\n  --no-discovery         Disable UDP discovery\n  --help                 Show this help`);
}

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  showHelp();
  process.exit(0);
}

const agent = new Agent({
  deviceName: options.name,
  httpPort: options.port,
  udpPort: options.udpport,
  dataDir: options.datadir,
  enableDiscovery: options.enablediscovery !== false
});

try {
  await agent.start();
  console.log(`MyBridge is running at http://127.0.0.1:${agent.port}`);
  console.log(`Device: ${agent.store.get().deviceName}`);
  console.log("Open the URL in a browser to configure this device.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}

const shutdown = async () => {
  await agent.stop();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

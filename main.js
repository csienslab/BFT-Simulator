'use strict';

const cliProgress = require('cli-progress');
const math = require('mathjs');
const Simulator = require("./simulator");
const config = require("./config");

const multibar = new cliProgress.MultiBar({
    format: ' {bar} | {payload} | {value}/{total} | Percentage: {percentage} %| ETA: {eta}',
    hideCursor: true,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    clearOnComplete: true,
    stopOnComplete: true
});

// initialize simulator with config
const s = new Simulator(config);

// show progress bar during execution
const progressBar = multibar.create(config.repeatTime, 0, { payload: `${config.protocol}-${config.nodeNum}-${config.byzantineNodeNum}-${config.networkDelay.mean}-${config.networkDelay.std}-${config.lambda}` });
s.onDecision = () => {
    progressBar.increment();
    progressBar.render();
}

// begin simulation
s.startSimulation();

const pipeline = config.protocol.includes("hotstuff") || config.protocol === "libra";

// collect result
const latencyData = s.simulationResults.map(x => pipeline ? x.latency / 100 : x.latency);
const msgCountData = s.simulationResults.map(x => pipeline ? x.totalMsgCount / 100 : x.totalMsgCount);

// show simulation result
console.log(`\nProtocol: ${config.protocol}, (n, f) = (${config.nodeNum}, ${config.byzantineNodeNum}), attacker: ${config.attacker}`);
console.log(`lambda (ms) = ${config.lambda * 1000}, network delay (ms): (mean, std) = (${config.networkDelay.mean * 1000}, ${config.networkDelay.std * 1000})`);
console.log(`Time usage (ms): (mean, std) = (${math.mean(latencyData).toFixed(2)}, ${Math.round(math.std(latencyData))}), median = ${math.median(latencyData).toFixed(2)}`);
console.log(`Message count:   (mean, std) = (${math.mean(msgCountData).toFixed(2)}, ${math.std(msgCountData).toFixed(2)})`);

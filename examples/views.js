'use strict';
// This script records nodes' view during protocol execution
const cliProgress = require('cli-progress');
const math = require('mathjs');
const fs = require('fs');
const Simulator = require("../simulator");
const config = require("../config");

// configuration
const viewPath = "./views"; // the dir to put logs in it
const clearLog = true;      // change to false if old logs should be preserved

// initialize simulator with config
const s = new Simulator(config);
const info = `${config.protocol}-${config.nodeNum}-${config.byzantineNodeNum}-${config.networkDelay.mean}-${config.networkDelay.std}-${config.lambda}`;

// show progress bar during execution
const multibar = new cliProgress.MultiBar({
    format: ' {bar} | {payload} | {value}/{total} | Percentage: {percentage} %| ETA: {eta}',
    hideCursor: true,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    clearOnComplete: true,
    stopOnComplete: true
});
const progressBar = multibar.create(config.repeatTime, 0, { payload: info });

// record views
let maxViewDiff = 0;
let recordedViews = { timestamp: [] };

const getViewDifference = () => {
    let minView = undefined;
    let maxView = undefined;
    for (let nodeID = 1; nodeID <= s.correctNodeNum; nodeID++) {
            const currView = s.nodes[nodeID].lastVotedView || 0;
            if (minView === undefined || minView > currView) {
                minView = currView;
            }
            if (maxView === undefined || maxView < currView) {
                maxView = currView;
            }
    }
    if (maxView !== undefined && minView !== undefined && maxView - minView > maxViewDiff) {
        maxViewDiff = maxView - minView;
    }
}

const recordNodesView = () => {
    // Record current timestamp
    recordedViews['timestamp'].push(s.clock.toFixed(2));

    // Record views
    for (let nodeID = 1; nodeID <= s.correctNodeNum; nodeID++) {
        // Init new array for each node
        if (!recordedViews[nodeID]) recordedViews[nodeID] = [];

        let nodeView = s.nodes[nodeID].lastVotedView || 0;
        recordedViews[nodeID].push(nodeView);
    }
}

const writeViewsToFile = (filename) => {
    fs.writeFileSync(filename, `${maxViewDiff}\n`);
    fs.appendFileSync(filename, recordedViews['timestamp'].join(",") + "\n");
    for (let nodeID = 1; nodeID <= s.correctNodeNum; nodeID++) {
        fs.appendFileSync(filename, recordedViews[nodeID].join(",") + "\n");
    }
}

// define callback functions
s.onDecision = () => {
    progressBar.increment();
    progressBar.render();
    writeViewsToFile(`${viewPath}/${info}_${s.simCount + 1}.csv`);
    maxViewDiff = 0;
    recordedViews = { timestamp: [] };
}

s.onEventsProccessed = () => {
    getViewDifference();
    recordNodesView();
}

// clear log
if (clearLog && fs.existsSync(viewPath))
    fs.rmSync(viewPath, { recursive: true, force: true });
if (!fs.existsSync(viewPath)) fs.mkdirSync(viewPath);

// begin simulation
s.startSimulation();

// collect result
const latencyData = s.simulationResults.map(x => { return x.latency });
const msgCountData = s.simulationResults.map(x => { return x.totalMsgCount });

// show simulation result
console.log(`\nProtocol: ${config.protocol}, (n, f) = (${config.nodeNum + config.byzantineNodeNum}, ${config.byzantineNodeNum}), attacker: ${config.attacker}`);
console.log(`lambda (ms) = ${config.lambda * 1000}, network delay (ms): (mean, std) = (${config.networkDelay.mean * 1000}, ${config.networkDelay.std * 1000})`);
console.log(`Time usage (ms): (mean, std) = (${Math.round(math.mean(latencyData))}, ${Math.round(math.std(latencyData))}), median = ${Math.round(math.median(latencyData))}`);
console.log(`Message count:   (mean, std) = (${Math.round(math.mean(msgCountData))}, ${math.std(msgCountData).toFixed(2)})`);

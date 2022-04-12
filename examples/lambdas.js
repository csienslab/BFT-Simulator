'use strict';
// this script run simulation through different lambda settings
const cliProgress = require('cli-progress');
const math = require('mathjs');
const fs = require("fs");
const Simulator = require("../simulator");
const config = require("../config");

const info = `${config.protocol}-${config.nodeNum}-${config.byzantineNodeNum}-${config.networkDelay.mean}-${config.networkDelay.std}`;

// configuration
// set lambda from start ~ end (included), each time increased by delta
const lambda_start = 0.1;
const lambda_end = 2;
const lambda_delta = 0.1;
// log result
const log = true;
const clearLog = true;
const logPath = "./experiments-log";
const filename = `${logPath}/${info}-lambda-${lambda_start}-${lambda_end}.csv`;

const multibar = new cliProgress.MultiBar({
    format: ' {bar} | {payload} | {value}/{total} | Percentage: {percentage} %| ETA: {eta}',
    hideCursor: true,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    clearOnComplete: true,
    stopOnComplete: true
});

// clear log
if (clearLog && fs.existsSync(logPath))
    fs.rmSync(logPath, { recursive: true, force: true });

if (log) {
    if (!fs.existsSync(logPath)) fs.mkdirSync(logPath);
    fs.writeFileSync(filename, "Lambda (ms),Time usage mean (ms),Time usage std (ms),Time usage median (ms),Message count mean,Message count std\n");
}

for (let lambda = lambda_start; lambda <= lambda_end; lambda += lambda_delta) {
    lambda = parseFloat(lambda.toFixed(3));
    config.lambda = lambda;
    const s = new Simulator(config);
    const progressBar = multibar.create(config.repeatTime, 0, { payload: `${info}-${config.lambda}` });
    s.onDecision = () => {
        progressBar.increment();
        progressBar.render();
    }
    s.startSimulation();
    const latencyData = s.simulationResults.map(x => { return x.latency });
    const msgCountData = s.simulationResults.map(x => { return x.totalMsgCount });

    if (log) {
        fs.appendFileSync(filename, `${1000 * lambda},${Math.round(math.mean(latencyData))},${Math.round(math.std(latencyData))},${Math.round(math.median(latencyData))},`);
        fs.appendFileSync(filename, `${math.mean(msgCountData)},${math.std(msgCountData).toFixed(2)}\n`);
        console.log("");
    }
    else {
        console.log(`\nTime usage (ms): (mean, std) = (${Math.round(math.mean(latencyData))}, ${Math.round(math.std(latencyData))}), median = ${Math.round(math.median(latencyData))}`);
        console.log(`Message count:   (mean, std) = (${Math.round(math.mean(msgCountData))}, ${math.std(msgCountData).toFixed(2)})`);
    }
}

'use strict';

const fs = require('fs');
const config = require('../config');

class Logger {

    write(line) {
        fs.appendFileSync(`${Logger.dir}/${this.nodeID}.log`, line + '\n');
    }

    logMsg(level, msgArr) {
		let msg = `[${level}] `;
		for (let i = 0; i < msgArr.length - 1; i++)
			msg += '[' + msgArr[i] + '] ';
		msg += msgArr[msgArr.length - 1];
        if (config.logToFile) this.write(msg);
    }
    
	info(msgArr) {
		this.logMsg('info', msgArr);
    }
    
	warning(msgArr) {
		this.logMsg('warning', msgArr);
    }
    
	error(msgArr) {
		this.logMsg('error', msgArr);
    }

    round(n, digit) {
        digit = digit || 1;
        return Math.round(n / digit);
    }
    
    constructor(nodeID) {
        this.nodeID = nodeID;
        this.fileName = `${Logger.dir}/${this.nodeID}.log`;
    }

    static clearLogDir() {
        fs.rmSync(this.dir, { recursive: true, force: true });
        fs.mkdirSync(this.dir);
    }
}
Logger.dir = './log';
module.exports = Logger;

'use strict';
// implement network that pass JSON object
const config = require('../config');
const fs = require('fs');

class MockNetwork {

       transfer(packet) {
        if (packet.dst === 'system') {
            this.sendToSystem(packet.content);
            return;
        }
        if (this.init) {
            this.startTime = Date.now();
            this.init = false;
        }
        /*
        if (packet.dst !== 'broadcast' &&
            this.availableDst.has(packet.dst) &&
            this.sockets[packet.dst] === undefined) {
            this.queue.push(packet);
            return;
        }*/
        let packets = [];
        // add delay according to config
        if (packet.dst === 'broadcast') {
            for (let nodeID of this.availableDst) {
                if (nodeID === packet.src) {
                    continue;
                }
                packet.delay = 0;   
                packet.dst = nodeID;
                packets.push(JSON.parse(JSON.stringify(packet)));
            }
        }
        else {
            packet.delay = 0;
            packets.push(packet);
        }
        this.totalMsgCount += packets.length;

        packets.forEach((packet) => {
            if (this.msgCount[packet.content.type] === undefined) {
                this.msgCount[packet.content.type] = 1;
            }
            else {
                this.msgCount[packet.content.type]++;                
            }
            this.registerMsgEvent(packet);
        });
    }


    removeNodes() {
        this.totalMsgCount = 0;
        this.totalMsgBytes = 0;
        this.msgCount = {};
        this.availableDst = [];
        this.init = true;
    }
    addNodes(nodes) {
        for (let nodeID in nodes) {
            this.availableDst.push(nodeID);
        }
    }

    constructor(sendToSystem, registerMsgEvent) {
        this.sendToSystem = sendToSystem;
        this.registerMsgEvent = registerMsgEvent;

        this.msgCount = {};
        this.totalMsgCount = 0;
        this.totalMsgBytes = 0;
        this.init = true;
        this.availableDst = [];        
    }}

class AuditChecker {

    addMsg(msg) {
        this.queue.addMsg(msg);
    }

    logMsg(msgEvent) {
        this.queue.push(msgEvent);
    }

    logToFile() {
        fs.appendFileSync(`./${this.logPath}.log`, JSON.stringify(this.queue));
    }

    addMsgEvent(msgEvent) {

    }

    logFromFile() {
        let queue = JSON.parse(fs.readFileSync(`./${this.logPath}.log`));
        this.queue = queue.reverse();
    }

    isMatch(groundTruth, event) {
        if (groundTruth['type'] !== event['type']) {
            return false;
        }

        if (
            groundTruth['packet']['src'] !== event['packet']['src'] ||
            groundTruth['packet']['dst'] !== event['packet']['dst'] ||
            groundTruth['packet']['content']['type'] !== event['packet']['content']['type']
            // groundTruth['packet']['content']['v'] !== event['packet']['content']['v']
        ) {
            return false;
        }
        return true;
    }

    nextMsgEvent() {
        let peek = this.queue[this.queue.length - 1];
        for (let i = 0; i < this.eventBasket.length; i++) {
            let event = this.eventBasket[i];
            if (this.isMatch(peek, event)) {
                this.eventBasket.splice(i, 1);
                this.queue.pop();
                return event;
            }
        }
        return null;
    }

    constructor(logPath, sendToSystem) {
        this.logPath = logPath;
        this.queue = [];
        this.eventBasket = [];
        this.clock = 0;

        this.network = new MockNetwork(sendToSystem, (packet) => {
            this.eventBasket.push({
                    type: 'msg-event',
                    packet: packet,
                    dst: packet.dst,
                    registeredTime: this.clock,
                    triggeredTime: this.clock,
            });
        })
    }
}

module.exports = AuditChecker;
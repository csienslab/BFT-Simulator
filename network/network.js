'use strict';
// implement network that pass JSON object
let config = require('../config');
const Attacker = (config.attacker) ?
    require('../attacker/' + config.attacker) : undefined;
    
class Network {

    getDelay(mean, std) {
        function get01BM() {
            let u = 0, v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
        }
        const delay = get01BM() * std + mean;
        return (delay < 0) ? 0 : delay;
    }
    
    getJSONSize(json) {
        let size = 0;
        for (let key in json) {
            size += key.length;
            switch (typeof json[key]) {
            case 'string':
                // a terrible workaround to avoid size difference
                // i is sender in PBFT
                if (key === 'sender' || key === 'i' || key === 'y') {
                    size += 4;
                }
                else {
                    size += json[key].length;
                }
                break;
            case 'number':
                size += 4;
                break;
            case 'object':
                if (Array.isArray(json[key])) {
                    // array of obj
                    for (let obj of json[key]) {
                        size += this.getJSONSize(obj);
                    }
                }
                else {
                    // normal json
                    size += this.getJSONSize(json[key]);
                }
                break;
            
            default:
                break;
            }
        }
        return size;
    }

    transfer(packet) {
        if (packet.dst === 'system') {
            this.sendToSystem(packet.content);
            return;
        }
        if (this.init) {
            this.startTime = Date.now();
            this.init = false;
        }
        let packets = [];
        // add delay according to config
        if (packet.dst === 'broadcast') {
            for (let nodeID of this.availableDst) {
                if (nodeID === packet.src) {
                    continue;
                }
                packet.delay = 
                    this.getDelay(config.networkDelay.mean, config.networkDelay.std);        
                packet.dst = nodeID;
                packets.push(JSON.parse(JSON.stringify(packet)));
            }
        }
        else {
            packet.delay = 
                this.getDelay(config.networkDelay.mean, config.networkDelay.std);
            packets.push(packet);
        }
        // attacker attack function
        if (Attacker !== undefined &&
            packet.src !== 'system' && packet.dst !== 'system' &&
            packet.src !== 'attacker' && packet.dst !== 'attacker') {
            packets = this.attacker.attack(packets);
            // filter unavailable dst packets
            packets = packets
                .filter(packet => this.availableDst.has(packet.dst));
        }
        this.totalMsgCount += packets.length;
        this.totalMsgBytes += packets.reduce(
            (sum, packet) => sum + this.getJSONSize(packet.content), 0);
        // send packets
        packets.forEach((packet) => {
            if (this.msgCount[packet.content.type] === undefined) {
                this.msgCount[packet.content.type] = 1;
            }
            else {
                this.msgCount[packet.content.type]++;                
            }
            this.registerMsgEvent(packet, packet.delay * 1000);
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

    constructor(sendToSystem, registerMsgEvent, registerAttackerTimeEvent, eventQ, nodeNum, byzantinNodeNum, getClockTime, customized_config) {
        if (customized_config !== undefined) {
            config = customized_config;
        }
        this.sendToSystem = sendToSystem;
        this.registerMsgEvent = registerMsgEvent;
        if (Attacker !== undefined) {
            this.attacker = new Attacker(
                (packet) => this.transfer(packet),
                registerAttackerTimeEvent,
                eventQ,
                nodeNum,
                byzantinNodeNum,
                getClockTime,
            );
        }
        this.msgCount = {};
        this.totalMsgCount = 0;
        this.totalMsgBytes = 0;
        this.init = true;
        this.availableDst = [];        
        this.nodeNum;
        this.byzantinNodeNum;
    }
}

module.exports = Network;

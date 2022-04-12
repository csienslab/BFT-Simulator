'use strict';
const Logger = require('../lib/logger');
require('../lib/fp');

class Node {
    onMsgEvent(msgEvent) {
        this.clock = msgEvent.triggeredTime;
    }

    onTimeEvent(timeEvent) {
        this.clock = timeEvent.triggeredTime;
    }

    send(src, dst, msg) {
        if (this.isCooling) {
            return;
        }
        if (dst !== 'system') {
            this.logger.info(['send', this.clock, dst, JSON.stringify(msg)]);
        }
        const packet = {
            src: src,
            dst: dst,
            content: msg,
            sendTime: this.clock
        };
        this.network.transfer(packet);
    }

    constructor(nodeID, nodeNum, network, registerTimeEvent) {
        this.nodeID = nodeID;
        this.nodeNum = nodeNum;
        this.logger = new Logger(this.nodeID);
        this.isCooling = false;
        this.network = network;
        this.registerTimeEvent = registerTimeEvent;
        this.clock = 0;
    }
}
module.exports = Node;
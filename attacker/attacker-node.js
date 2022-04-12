'use strict';

const Node = require('../ba-algo/node');

class AttackerNode extends Node {
    
    constructor(nodeID, nodeNum, network, registerTimeEvent, onMsgEvent, onTimeEvent) {
        super(nodeID, nodeNum, network, registerTimeEvent)
        this.registerTimeEvent = registerTimeEvent;
        this.onMsgEvent = onMsgEvent;
        this.onTimeEvent = onTimeEvent;
    }
}

module.exports = AttackerNode;
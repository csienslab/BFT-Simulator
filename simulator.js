'use strict';

const Logger = require('./lib/logger');
const Network = require('./network/network');
const FastPriorityQueue = require('fastpriorityqueue');
const ValidatorModule = require('./validator/audit_queue');

class Simulator {
    registerTimeEvent(functionMeta, waitTime, eventQ, nodeID) {
        eventQ.add({
            type: 'time-event',
            functionMeta: functionMeta,
            dst: '' + nodeID,
            registeredTime: this.clock,
            triggeredTime: this.clock + waitTime
        });
    }

    registerMsgEvent(packet, waitTime, eventQ) {
        eventQ.add({
            type: 'msg-event',
            packet: packet,
            dst: packet.dst,
            registeredTime: this.clock,
            triggeredTime: this.clock + waitTime
        });
    }

    registerAttackerTimeEvent(functionMeta, waitTime, eventQ) {
        eventQ.add({
            type: 'attacker-time-event',
            functionMeta: functionMeta,
            registeredTime: this.clock,
            triggeredTime: this.clock + waitTime
        });
    }

    startSimulation() {
        for (; this.network.attacker.updateParam() || this.simCount < this.config.repeatTime; this.simCount++) {
            this.runOnce();
            this.reset();
        }
    }

    runOnce() {
        for (let nodeID = 1; nodeID <= this.correctNodeNum; nodeID++) {
            this.nodes[nodeID] = new this.Node(
                '' + nodeID,
                this.nodeNum,
                this.network,
                // register time event
                (functionMeta, waitTime) => {
                    return this.registerTimeEvent(functionMeta, waitTime, this.eventQ, nodeID)
                },
                this.config,
            );
        }

        this.network.addNodes(this.nodes);

        // main loop - run till one simulation ends
        while (!this.eventQ.isEmpty()) {
            // pop events that should be processed
            const waitingEvents = [];
            this.clock = this.eventQ.peek().triggeredTime;
            while (!this.eventQ.isEmpty() && this.eventQ.peek().triggeredTime === this.clock)
                waitingEvents.push(this.eventQ.poll());
            this.eventQ.trim();

            waitingEvents.forEach((e) => {
                switch (e.type) {
                    case 'msg-event':
                        this.nodes[e.dst].onMsgEvent(e); break;
                    case 'time-event':
                        this.nodes[e.dst].onTimeEvent(e); break;
                    case 'attacker-time-event':
                        this.network.attacker.onTimeEvent(e); break;
                }
            });

            if (this.onEventsProccessed) this.onEventsProccessed();
            if (this.judge()) return this.decided();
        }
        console.log("Error! eventQ is empty before simulation ends!");
    }

    // judge determines whether a consensus is reached or not
    judge() {
        let decideCount = 0;
        for (let nodeID = 1; nodeID <= this.correctNodeNum; nodeID++) {
            if (this.nodes[nodeID].isDecided) {
                decideCount += 1;
            }
        }

        return decideCount >= this.majority;
    }

    decided() {
        this.simulationResults.push({
            latency: this.clock,
            msgBytes: this.network.totalMsgBytes,
            msgCount: this.network.msgCount,
            totalMsgCount: this.network.totalMsgCount,
        });
        if (this.onDecision) this.onDecision();
    }

    reset() {
        this.eventQ.removeMany(() => true);
        this.eventQ.trim();
        this.clock = 0;
        this.nodes = {};
        this.network.removeNodes();
    }

    startValidator() {
        this.simCount++;
        this.auditor = new ValidatorModule(this.config.validatorLogPath,
            // send to system
            () => {}
        );
        // load ground truth.
        this.auditor.logFromFile();

        for (let nodeID = 1; nodeID <= this.correctNodeNum; nodeID++) {
            this.nodes[nodeID] = new this.Node(
                '' + nodeID,
                this.nodeNum,
                // auditor would mock a network that simply saves all packets.
                this.auditor.network,
                // register time event
                (functionMeta, waitTime) => {
                    this.eventQ.add({
                        type: 'time-event',
                        functionMeta: functionMeta,
                        dst: '' + nodeID,
                        registeredTime: this.clock,
                        triggeredTime: this.clock + waitTime
                    });
                }
            );
            if (nodeID === this.correctNodeNum) {
                this.auditor.network.addNodes(this.nodes);
            }
        }

        // main loop
        while (true) {
            const timeEvents = [];
            let nextMsgEvent = this.auditor.nextMsgEvent();
            if (nextMsgEvent !== null ){
                this.nodes[nextMsgEvent.dst].onMsgEvent(nextMsgEvent);
            } else {
                // if there's no matched msgevent then trigger the time event.
                this.clock = this.eventQ.peek().triggeredTime;
                console.log("triggering event", this.eventQ.peek());
                const msgEvents = [];
                while (!this.eventQ.isEmpty() &&
                    this.eventQ.peek().triggeredTime === this.clock) {
                    const event = this.eventQ.poll();
                    switch (event.type) {
                        // there should only be time event.
                        case 'msg-event':
                            msgEvents.push(event);
                            break;
                        case 'time-event':
                            timeEvents.push(event);
                            break;
                        case 'attacker-time-event':
                            attackerTimeEvents.push(event);
                    }
                }
                console.log(`there's ${timeEvents.length} time events`);
                timeEvents.forEach((event) => {
                    console.log(event);
                    this.nodes[event.dst].onTimeEvent(event);
                });
            }
            this.judge();
        }

    }

    constructor(config) {
        Logger.clearLogDir();
        this.eventQ = new FastPriorityQueue((eventA, eventB) => {
            return eventA.triggeredTime < eventB.triggeredTime;
        });
        this.config = config;
        this.clock = 0;
        this.simCount = 0;
        this.Node = require(`./ba-algo/${config.protocol}`);
        this.nodes = {};
        this.nodeNum = config.nodeNum;
        this.byzantineNodeNum = config.byzantineNodeNum;
        this.correctNodeNum = this.nodeNum - this.byzantineNodeNum;
        this.majority = this.nodeNum - Math.floor((this.nodeNum - 1) / 3);
        this.simulationResults = [];

        // callback functions
        this.onEventsProccessed = undefined;
        this.onDecision = undefined;

        this.network = new Network(
            // send to system
            () => {},
            // register msg event
            (packet, waitTime) => {
                this.eventQ.add({
                    type: 'msg-event',
                    packet: packet,
                    dst: packet.dst,
                    registeredTime: this.clock,
                    triggeredTime: this.clock + waitTime
                });
            },
            // register attacker time event
            (functionMeta, waitTime) => {
                return this.registerAttackerTimeEvent(functionMeta, waitTime, this.eventQ)
            },
            this.eventQ,
            this.nodeNum,
            this.byzantineNodeNum,
            // get clock
            () => this.clock,
            config
        );
    }
};

module.exports = Simulator;

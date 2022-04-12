'use strict';

const Node = require('../node');
const config = require('../../config');
const uuid = require('uuid/v4');

class VMwareNode extends Node {

    // extend vector v to be able to access v[n] = array
    extendVector(v, n) {
        if (v[n] === undefined) {
            v[n] = [];
        }
    }

    decide(v) {
        //clearTimeout(this.BALogicTimer);
        this.logger.info([`decide on ${v}`]);
        this.isDecided = true;
        this.decidedValue = v;
    }

    runBALogic(round) {
        switch (round) {
        case 1:
            // end of notify and start of status
            this.extendVector(this.notify, this.k);
            if (this.notify[this.k].length > 0) {
                const msg = this.notify[this.k][0];
                this.accepted.vi = msg.header.v;
                this.accepted.Ci = msg.Ci;
                this.accepted.ki = this.k;
            };
            this.k++;
            const statusMsg = {
                sender: this.nodeID,
                type: 'status',
                k: this.k,
                vi: this.accepted.vi,
                ki: this.accepted.ki,
                Ci: this.accepted.Ci
            };
            this.status.push(statusMsg);
            this.send(this.nodeID, 'broadcast', statusMsg);
            this.registerTimeEvent(
                { name: 'runBALogic', params: { round: 2 } },
                2 * config.lambda * 1000
            );
            break;
        case 2:
            // end of status and start of propose
            this.accepted.vi = uuid();
            this.accepted.ki = 0;
            this.accepted.Ci = 'undefined';
            if (this.status.length > 0) {
                const msg = this.status
                    .groupBy(msg => msg.ki)
                    // [['ki', [status msg]], ['ki', [status msg]]]
                    .maxBy(arr => parseInt(arr[0]))[1][0];
                if (msg.Ci !== 'undefined') {
                    this.accepted.vi = msg.vi;
                    this.accepted.ki = msg.ki;
                    this.accepted.Ci = msg.Ci;
                }
            }
            const proposeMsg = {
                sender: this.nodeID,
                type: 'fl-propose',
                proposeMsg: {
                    sender: this.nodeID,
                    k: this.k,
                    type: 'propose',
                    vL: this.accepted.vi,
                    // VRF
                    y: Math.floor(Math.random() * 1000000000 + 1)
                },
                kL: this.accepted.ki,
                CL: this.accepted.Ci
            };
            this.send(this.nodeID, 'broadcast', proposeMsg);
            this.flPropose.push(proposeMsg);
            this.status = [];
            this.registerTimeEvent(
                { name: 'runBALogic', params: { round: 3 } },
                2 * config.lambda * 1000
            );
            /*
            this.BALogicTimer = setTimeout(() => {
                this.runBALogic(3);
            }, 2 * config.lambda * 1000);*/
            break;
        case 3:
            // end of propose and start of commit
            // remove duplicate leader proposal
            this.flPropose = this.flPropose
                .groupBy(msg => msg.sender)
                // [[sender, [msg]], [sender, [msg]]]
                .filter(arr => arr[1].length <= 1)
                .map(arr => arr[1])
                // [[msg], [msg]]
                .flat();
            this.flPropose.sort((msgA, msgB) => {
                if (msgA.kL < msgB.kL) {
                    return 1;
                }
                else if (msgA.kL > msgB.kL) {
                    return -1;
                }
                else {
                    return (msgA.proposeMsg.y < msgB.proposeMsg.y) ? 1 : -1;
                }
            });
            const bestProposal = this.flPropose[0];
            if (bestProposal === undefined || bestProposal.kL < this.accepted.ki) {
                // leader is faulty or no leader
                this.vLi = 'undefined';
            }
            else {
                this.proposeMsg = bestProposal.proposeMsg;
                this.vLi = this.proposeMsg.vL;
            }
            if (this.vLi !== 'undefined') {
                // forward leader propose
                this.send(this.nodeID, 'broadcast', this.proposeMsg);
                const commitMsg = {
                    sender: this.nodeID,
                    k: this.k,
                    type: 'commit',
                    vLi: this.vLi,
                    y: this.proposeMsg.y
                };
                this.send(this.nodeID, 'broadcast', commitMsg);
                this.commit.push(commitMsg);
            }
            this.flPropose = [];
            this.registerTimeEvent(
                { name: 'runBALogic', params: { round: 4 } },
                2 * config.lambda * 1000
            );
            /*
            this.BALogicTimer = setTimeout(() => {
                this.runBALogic(4);
            }, 2 * config.lambda * 1000);*/
            break;
        case 4:
            // end of commit and start of notify
            if (this.propose.some(msg => 
                msg.k === this.k && msg.vL !== this.vLi)) {
                // leader has equivocated
                // do not commit
                this.logger.warning(['leader has equivocated']);
            }
            else {
                const C = this.commit.filter(
                    msg => msg.vLi === this.vLi && msg.k === this.k);
                if (C.length >= this.nodeNum - this.f) {
                    this.accepted.vi = this.vLi;
                    this.accepted.Ci = C;
                    const proof = 
                        JSON.parse(JSON.stringify(C)).splice(0, this.nodeNum - this.f);
                    const notifyMsg = {
                        sender: this.nodeID,
                        type: 'notify',
                        header: {
                            sender: this.nodeID,
                            type: 'notify-header',
                            v: this.vLi
                        },
                        Ci: proof
                    };
                    this.send(this.nodeID, 'broadcast', notifyMsg);
                    const k = notifyMsg.Ci[0].k;
                    this.extendVector(this.notify, k);
                    this.notify[k].push(notifyMsg);                    
                }
            }
            this.propose = [];
            this.commit = [];
            this.vLi = 'undefined';
            this.registerTimeEvent(
                { name: 'runBALogic', params: { round: 1 } },
                2 * config.lambda * 1000
            );
            /*
            this.BALogicTimer = setTimeout(() => {
                this.runBALogic(1);
            }, 2 * config.lambda * 1000);*/
            break;
        default:
            this.logger.warning(['unknown round']);
        }

    }

    onMsgEvent(msgEvent) {
        super.onMsgEvent(msgEvent);
        const msg = msgEvent.packet.content;        
        this.logger.info(['recv', this.logger.round(msgEvent.triggeredTime), JSON.stringify(msg)]);
        if (this.isDecided) {
            return;
        }
        switch(msg.type) {
        case 'status':
            // verify msg.Ci
            this.status.push(msg);
            break;
        case 'fl-propose':
            this.flPropose.push(msg);
            break;
        case 'propose':
            this.propose.push(msg);
            break;
        case 'commit':
            this.commit.push(msg);
            break;
        case 'notify':
            const k = msg.Ci[0].k;
            this.extendVector(this.notify, k);
            this.notify[k].push(msg);
            if (this.notify[k].length >= this.f + 1) {
                const headers = this.notify[k]
                    .map(notifyMsg => notifyMsg.header);
                const headerMsg = {
                    sender: this.nodeID,
                    type: 'notify-headers',
                    headers: headers
                };
                this.send(this.nodeID, 'broadcast', headerMsg);
                this.decide(headers[0].v);
            }
            break;
        case 'notify-headers':
            // sanity check
            const headerMsg = {
                sender: this.nodeID,
                type: 'notify-headers',
                headers: msg.headers
            };
            this.send(this.nodeID, 'broadcast', headerMsg);
            this.decide(msg.headers[0].v);
            break;
        default: 
            this.logger.warning(['unknown message type']);
        }
    }

    onTimeEvent(timeEvent) {
        super.onTimeEvent(timeEvent);
        if (this.isDecided) {
            return;
        }
        const functionMeta = timeEvent.functionMeta;        
        switch (functionMeta.name) {
        case 'start':
            const initStatusMsg = {
                sender: this.nodeID,
                type: 'status',
                k: this.k,
                vi: this.accepted.vi,
                ki: this.accepted.ki,
                Ci: this.accepted.Ci
            };
            this.status.push(initStatusMsg);
            this.send(this.nodeID, 'broadcast', initStatusMsg);
            this.registerTimeEvent(
                { name: 'runBALogic', params: { round: 2 } }, 
                2 * config.lambda * 1000
            );
            break;
        case 'runBALogic':
            this.runBALogic(functionMeta.params.round);
            break;
        }
    }

    constructor(nodeID, nodeNum, network, registerTimeEvent) {
        super(nodeID, nodeNum, network, registerTimeEvent);
        //this.isCooling = false;
        this.f = (this.nodeNum % 2 === 0) ?
            this.nodeNum / 2 - 1 : (this.nodeNum - 1) / 2;
        
        // BA related
        // store all accepted
        this.accepteds = [];
        this.accepted = { 
            vi: 'undefined', 
            ki: 0,
            Ci: 'undefined'
        };
        this.k = 1;
        this.vLi = 'undefined';
        this.leader;
        this.status = [];
        this.flPropose = [];
        this.propose = [];
        this.commit = [];
        this.notify = [];
        this.isDecided = false;
        this.decidedValue = undefined;        
        
        this.registerTimeEvent({ name: 'start', params: {} }, 0);
        /*
        const targetStartTime = process.argv[4];
        setTimeout(() => {
            this.send(this.nodeID, 'broadcast', initStatusMsg);
            // go to round 2 after 2l
            setTimeout(() => {
                this.runBALogic(2);
            }, 2 * config.lambda * 1000);
        }, targetStartTime - Date.now());*/
    }
}
//const n = new VMwareNode(process.argv[2], process.argv[3]);
module.exports = VMwareNode;
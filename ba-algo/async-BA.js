'use strict';

const uuid = require('uuid/v4');
const Node = require('./node');

class ABANode extends Node {
    // count of an element in an array
    getCount(a, v) {
        if (a === undefined || a.length === 0) {
            return 0
        }
        const valueMap = {};
        data.forEach(msg => {
            if (valueMap[msg.value] === undefined) {
                valueMap[msg.value] = 1;
            }
            else {
                valueMap[msg.value]++;
            }
        });
        let maxValue = undefined;
        let maxCount = 0;
        for (let value in valueMap) {
            if (valueMap[value] > maxCount) {
                maxCount = valueMap[value];
                maxValue = value;
            }
        }
        return { value: maxValue, count: maxCount };
    }
    // broadcast via 2pc
    broadcast2pc(v) {
        const initMsg = {
            type: 'init',
            sender: this.nodeID,
            v: v
        };
        this.send(this.nodeID, 'broadcast', initMsg);
        /*
        const echoMsg = {
            type: 'echo',
            sender: this.nodeID,
            v: v
        }*/
        //this.send(this.nodeID, 'broadcast', echoMsg);
        this.vBox[v.ID] = {
            init: [initMsg],
            echo: [],
            ready: [],
            v: v,
            step: 1,
            accept: false
        };
    }
    // receive via 2pc
    receive2pc(msg) {
        this.logger.warning(['accept', JSON.stringify(msg)]);
        function getMaxMsgV(msgArray) {
            if (msgArray === undefined || msgArray.length === 0) {
                return { value: undefined, count: 0 };
            }
            const valueMap = {};
            msgArray.forEach(msg => {
                if (valueMap[msg.value] === undefined) {
                    valueMap[msg.value] = 1;
                }
                else {
                    valueMap[msg.value]++;
                }
            });
            let maxValue = undefined;
            let maxCount = 0;
            for (let value in valueMap) {
                if (valueMap[value] > maxCount) {
                    maxCount = valueMap[value];
                    maxValue = value;
                }
            }
            return { value: maxValue, count: maxCount };
        }
        // validate should be added
        if (this.valids[msg.k] === undefined) {
            this.valids[msg.k] = [msg];
        }
        else {
            this.valids[msg.k].push(msg);
        }
        let k = 3 * this.phase + this.round;
        if (k !== msg.k) {
            return;
        }
        while (this.valids[k].length >= 2 * this.f + 1) {
            let maxV = getMaxMsgV(this.valids[k]);
            switch (this.round) {
                case 1:
                    this.valueP = maxV.value;
                    this.round++;
                    this.broadcast2pc({
                        k: 3 * this.phase + this.round,
                        sender: this.nodeID,
                        value: this.valueP,
                        ID: uuid()
                    });
                    this.logger.warning(['' + this.round]);
                    
                    break;
                case 2:
                    // this param is f + 1 or N / 2 ?
                    if (maxV.count >= //this.f + 1) {
                        Math.floor(this.nodeNum / 2) + 1) {
                        this.valueP = { v: maxV.value, d: true };
                    }
                    this.round++;
                    this.broadcast2pc({
                        k: 3 * this.phase + this.round,
                        sender: this.nodeID,
                        value: JSON.stringify(this.valueP),
                        ID: uuid()
                    });
                    break;
                case 3:
                    const value = JSON.parse(maxV.value);
                    // value = {v: 0, d: true} or 0
                    if (value.d === true && maxV.count >= 2 * this.f + 1) {
                        this.valueP = value.v;
                        this.decidedValue = this.valueP;
                        this.isDecided = true;
                    }
                    else if (value.d === true && maxV.count >= this.f + 1) {
                        this.valueP = value.v;
                    }
                    else {
                        this.valueP = Math.round(Math.random());
                    }
                    this.round = 1;
                    this.phase++;
                    this.broadcast2pc({
                        k: 3 * this.phase + this.round,
                        sender: this.nodeID,
                        value: this.valueP,
                        ID: uuid()
                    });
                    break;
                default:
                    this.logger.warning(['Undefined round.']);
            }
            k = 3 * this.phase + this.round;
            if (this.valids[k] === undefined) {
                this.valids[k] = [];
                break;
            }
        }
    }
    // receive from network
    onMsgEvent(msgEvent) {
        super.onMsgEvent(msgEvent);
        const msg = msgEvent.packet.content;
        this.logger.info(['recv', JSON.stringify(msg)]);
        const v = msg.v;
        if (this.vBox[v.ID] === undefined) {
            this.vBox[v.ID] = {
                init: [],
                echo: [],
                ready: [],
                v: v,
                step: 1,
                accept: false
            };
        }
        this.vBox[v.ID][msg.type].push(msg);
        switch (this.vBox[v.ID].step) {
            case 1:
                const echoMsg = {
                    type: 'echo',
                    sender: this.nodeID,
                    v: v
                };
                if (this.vBox[v.ID].init.length >= 1 ||
                    this.vBox[v.ID].echo.length >= 2 * this.f + 1 ||
                    this.vBox[v.ID].ready.length >= this.f + 1) {
                    this.vBox[v.ID].step = 2;
                    this.vBox[v.ID].echo.push(echoMsg);
                    this.send(this.nodeID, 'broadcast', echoMsg);
                }
                break;
            case 2:
                const readyMsg = {
                    type: 'ready',
                    sender: this.nodeID,
                    v: v
                };
                if (this.vBox[v.ID].echo.length >= 2 * this.f + 1 ||
                    this.vBox[v.ID].ready.length >= this.f + 1) {
                    this.vBox[v.ID].step = 3;
                    this.vBox[v.ID].ready.push(readyMsg);
                    this.send(this.nodeID, 'broadcast', readyMsg);
                }
                break;
            case 3:
                if (this.vBox[v.ID].ready.length >= this.f + 1 &&
                    !this.vBox[v.ID].accept) {
                    this.vBox[v.ID].accept = true;
                    this.receive2pc(v);
                }
                break;
            default:
                this.logger.warning(['Undefined step.']);
        }
    }

    onTimeEvent(timeEvent) {
        super.onTimeEvent(timeEvent);
        this.broadcast2pc(this.initV);
    }

    constructor(nodeID, nodeNum, network, registerTimeEvent) {
        super(nodeID, nodeNum, network, registerTimeEvent);
        this.f = (this.nodeNum % 3 === 0) ?
            this.nodeNum / 3 - 1 : Math.floor(this.nodeNum / 3);
        // 2 phase commit
        // v.ID => { initCount, readyCount, echoCount, v }
        this.vBox = {};
        // BA
        // round => array
        this.valids = [];
        this.isDecided = false;
        this.decidedValue = undefined;
        this.phase = 0;
        this.round = 1;
        // start BA process
        // propose init value
        this.initValue = '' + Math.round(Math.random());
        this.initV = {
            k: 3 * this.phase + this.round,
            sender: this.nodeID,
            value: this.initValue,
            ID: uuid()
        };
        this.registerTimeEvent({
            name: 'broadcast2pc'
        }, 0);
    }
}
//const n = new ABANode(process.argv[2], process.argv[3]);
module.exports = ABANode;

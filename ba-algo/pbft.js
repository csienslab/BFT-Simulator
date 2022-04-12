'use strict';

const Node = require('./node');
const uuid = require('uuid/v4');
const config = require('../config');

class PBFTNode extends Node {
    // extend vector v to be able to access v[n] = array
    extendVector(v, n) {
        if (v[n] === undefined) {
            v[n] = [];
        }
    }
    // extend vector v to be able to access v[n][m] = array
    extendVector2D(v, n, m) {
        if (v[n] === undefined) {
            this.extendVector(v, n);
        }
        if (v[n][m] === undefined) {
            this.extendVector(v[n], m);
        }
    }
    isPrepared(d, v, n) {
        // m is in log
        // pre-prepare<m, v, n> is in log
        // 2f + 1 prepare<v, n, d, i> is in log that match pre-prepare<m, v, n>
        if (this.digest[d] !== undefined &&
            this.prePrepare[v][n][0] !== undefined) {
            const d = this.prePrepare[v][n][0].d;
            const count = this.prepare[v][n].filter(msg => (msg.d === d)).length;
            return (count >= 2 * this.f + 1);
        }
        return false;
    }
    isCommittedLocal(d, v, n) {
        // isPrepared(d, v, n) is true
        // 2f + 1 commit<v, n, d, i> is in log that match pre-prepare<m, v, n>
        if (this.isPrepared(d, v, n)) {
            const d = this.prePrepare[v][n][0].d;
            const count = this.commit[v][n].filter(msg => (msg.d === d)).length;
            return (count >= 2 * this.f + 1);
        }
        return false;
    }
    isStableCheckpoint(n) {
        if (this.checkpoint[n] === undefined ||
            this.checkpoint[n].length === 0) {
            return false;
        }
        const count = this.checkpoint[n].groupBy(msg => msg.d)
            .map(e => e[1].length)
            .max();
        return (count >= 2 * this.f + 1);
    }

    handlePrePrepareMsg(msg) {
        // check signature, view, sequence number unique and its range
        if (msg.v !== this.view) {
            return;
        }
        // push pre-prepare
        this.extendVector2D(this.prePrepare, msg.v, msg.n);
        // pre-prepare[v][n] should only have one message
        if (this.prePrepare[msg.v][msg.n].length === 0) {
            //clearTimeout(this.receiveTimer);
            this.hasReceiveRequest = true;
            if (msg === undefined) { console.log("!! 67"); process.exit(0); }
            this.prePrepare[msg.v][msg.n].push(msg);
            if (this.digest[msg.d] === undefined) {
                this.digest[msg.d] = {
                    isReceived: true,
                    isPrepared: false,
                    isDecided: false,
                };
                this.registerTimeEvent(
                    { name: 'executeTimeout', params: { d: msg.d, v: msg.v } },
                    this.executeTimeout * 1000
                );
            }
            // send prepare
            const prepareMsg = {
                type: 'prepare',
                v: msg.v,
                n: msg.n,
                d: msg.d,
                i: this.nodeID
            };
            this.extendVector2D(this.prepare, msg.v, msg.n);
            this.prepare[msg.v][msg.n].push(prepareMsg);
            this.send(this.nodeID, 'broadcast', prepareMsg);
        }
        else {
            console.log(`${this.nodeID}, normal prepare conflict`);
            console.log('1', this.prePrepare[msg.v][msg.n][0]);
            console.log('2', msg);
            this.logger.warning(['normal pre-prepare conflict']);
        }
    }

    handlePrepareMsg(msg) {
        // check signature, view, sequence number unique and its range
        if (msg.v !== this.view) {
            return;
        }
        // push prepare
        this.extendVector2D(this.prePrepare, msg.v, msg.n);
        this.extendVector2D(this.prepare, msg.v, msg.n);
        // prepare may contain msg with different digests
        this.prepare[msg.v][msg.n].push(msg);
        if (this.digest[msg.d] && this.digest[msg.d].isPrepared) {
            return;
        }
        if (this.isPrepared(msg.d, msg.v, msg.n)) {
            this.digest[msg.d].isPrepared = true;
            const commitMsg = {
                type: 'commit',
                v: msg.v,
                n: msg.n,
                d: msg.d,
                i: this.nodeID
            };
            this.extendVector2D(this.commit, msg.v, msg.n);
            this.commit[msg.v][msg.n].push(commitMsg);
            this.send(this.nodeID, 'broadcast', commitMsg);
        }
    }

    onMsgEvent(msgEvent) {
        super.onMsgEvent(msgEvent);
        const msg = msgEvent.packet.content;
        this.logger.info(['recv',
            this.logger.round(msgEvent.triggeredTime),
            JSON.stringify(msg)]);
        if (this.isInViewChange &&
            (msg.type !== 'checkpoint' &&
                msg.type !== 'view-change' &&
                msg.type !== 'new-view' &&
                msg.type !== 'decide')) {
            return;
        }
        if (msg.type === 'pre-prepare') {
            this.handlePrePrepareMsg(msg);
        }
        else if (msg.type === 'prepare') {
            this.handlePrepareMsg(msg);
        }
        else if (msg.type === 'commit') {
            // check signature, view, sequence number unique and its range
            if (msg.v !== this.view) {
                return;
            }
            // push commit
            this.extendVector2D(this.prePrepare, msg.v, msg.n);
            this.extendVector2D(this.prepare, msg.v, msg.n);
            this.extendVector2D(this.commit, msg.v, msg.n);
            this.commit[msg.v][msg.n].push(msg);
            if (this.digest[msg.d] && this.digest[msg.d].isDecided) {
                return;
            }
            // check committed local
            if (this.isCommittedLocal(msg.d, msg.v, msg.n)) {
                //clearTimeout(this.digest[msg.d].timer);
                this.digest[msg.d].isDecided = true;
                this.lastDecidedSeq = msg.n;
                this.lastDecidedRequest = msg.d;
                this.logger.info(['decide', Math.round(this.clock), msg.d]);
                this.isDecided = true;
                const decideMsg = {
                    type: 'decide',
                    n: msg.n,
                    d: msg.d,
                    i: this.nodeID,
                    proof: this.commit[msg.v][msg.n].filter(comMsg => (comMsg.d === msg.d))
                };
                this.send(this.nodeID, 'broadcast', decideMsg);
                if (msg.n % this.checkpointPeriod === 0) {
                    const checkpointMsg = {
                        type: 'checkpoint',
                        n: msg.n,
                        d: msg.d,
                        i: this.nodeID
                    };
                    this.extendVector(this.checkpoint, msg.n);
                    this.checkpoint[msg.n].push(checkpointMsg);
                    this.send(this.nodeID, 'broadcast', checkpointMsg);
                }
            }
        }
        else if (msg.type === 'decide') {
            if (this.digest[msg.d] && this.digest[msg.d].isDecided) {
                return;
            }
            if (this.digest[msg.d] === undefined) {
                this.digest[msg.d] = {
                    isReceived: true,
                    isPrepared: true,
                    isDecided: true,
                };
            }
            this.digest[msg.d].isDecided = true;
            this.lastDecidedSeq = msg.n;
            this.lastDecidedRequest = msg.d;
            this.logger.info(['decide', msg.d]);
            this.isDecided = true;
            const decideMsg = {
                type: 'decide',
                n: msg.n,
                d: msg.d,
                i: this.nodeID,
                proof: msg.proof
            };
            this.send(this.nodeID, 'broadcast', decideMsg);
        }
        else if (msg.type === 'checkpoint') {
            this.extendVector(this.checkpoint, msg.n);
            this.checkpoint[msg.n].push(msg);
            // earliest checkpoint that is not stable
            let usCheckpoint =
                this.lastStableCheckpoint + this.checkpointPeriod;
            if (msg.n === usCheckpoint) {
                while (this.isStableCheckpoint(usCheckpoint)) {
                    this.logger.info([`create stable checkpoint ${usCheckpoint}`]);
                    this.lastStableCheckpoint = usCheckpoint;
                    usCheckpoint += this.checkpointPeriod;
                }
            }
        }
        else if (msg.type === 'view-change') {
            // somehow verify this is a reasonable view change msg
            // checkpoint proof is provided
            if (msg.v <= this.view) return;
            this.extendVector(this.viewChange, msg.v);
            this.viewChange[msg.v].push(msg);
            if (this.viewChange[msg.v].length >= this.f + 1 &&
                !this.isInViewChange && msg.v > this.view) {
                this.startViewChange(msg.v);
            }
            if (this.viewChange[msg.v].length >= 2 * this.f + 1 &&
                (msg.v % this.nodeNum) === (parseInt(this.nodeID) - 1) &&
                !this.isPrimary) {
                this.logger.info(['start as a primary']);
                this.isPrimary = true;
                this.isInViewChange = false;
                this.view = msg.v;
                let minS = this.viewChange[msg.v]
                    .map(msg => msg.n)
                    .max();
                //minS = minS < 0 ? 0 : minS;
                const allPrePrepare = this.viewChange[msg.v]
                    .map(msg => msg.P)
                    .map(P => P.map(Pm => Pm['pre-prepare']))
                    .flat();
                let maxS = (allPrePrepare.length === 0) ?
                    minS : allPrePrepare.map(msg => msg.n).max();
                //maxS = maxS < 0 ? 0 : maxS;
                const O = [];
                this.newViewPrepareMsgs = [];
                for (let n = minS + 1; n <= maxS; n++) {
                    const pmsg = allPrePrepare.find(msg => msg.n === n);
                    const d = (pmsg === undefined) ? 'nop' : pmsg.d;
                    // re-consensus d
                    this.digest[d] = {
                        isReceived: true,
                        isPrepared: false,
                        isDecided: false,
                    };
                    const prePrepareMsg = {
                        type: 'pre-prepare',
                        v: msg.v,
                        n: n,
                        d: d
                    };
                    this.extendVector2D(this.prePrepare, msg.v, n);
                    if (prePrepareMsg === undefined) { console.log("!! 274"); process.exit(0); }
                    this.prePrepare[msg.v][n].push(prePrepareMsg);
                    const prepareMsg = {
                        type: 'prepare',
                        v: msg.v,
                        n: n,
                        d: d,
                        i: this.nodeID
                    };
                    this.extendVector2D(this.prepare, msg.v, n);
                    this.prepare[msg.v][n].push(prepareMsg);
                    // broadcast this after every node enter view v
                    this.newViewPrepareMsgs.push(prepareMsg);
                    O.push({
                        v: msg.v,
                        n: n,
                        d: d
                    });
                }
                this.registerTimeEvent(
                    { name: 'broadcastNewViewPrepare' },
                    this.lambda * 1000
                );
                // next seq starts from maxS + 1
                this.seq = maxS + 1;
                const [prePrepareMsg, prepareMsg] = this.genRequest();
                const newViewMsg = {
                    type: 'new-view',
                    v: msg.v,
                    V: this.viewChange[msg.v],
                    O: O,
                    i: this.nodeID,
                    prePrepareMsg,
                    prepareMsg,
                };
                this.send(this.nodeID, 'broadcast', newViewMsg);
                // start as primary after every node enter view v
                // this.registerTimeEvent(
                //     { name: 'issueRequest' },
                //     this.lambda * 1000
                // );
            }
            else if (this.viewChange[msg.v].length >= 2 * this.f + 1) {
                this.registerTimeEvent(
                    { name: 'skipToNextView', params: { oldView: this.oldView } },
                    this.viewChangeTimeout * 1000
                );
            }
        }
        else if (msg.type === 'new-view') {
            // do not view change to smaller view
            if (msg.v <= this.view) return;
            // new primary
            if (this.isPrimary &&
                (msg.v % this.nodeNum) === (parseInt(this.nodeID) - 1)) {
                return;
            }
            // old primary
            if (this.isPrimary) {
                this.logger.info(['switch to backup node']);
                //clearInterval(this.proposeTimer);
                this.isPrimary = false;
            }
            // somehow verify O and V is reasonable
            this.logger.info(['enter new view', `${this.view} -> ${msg.v}`]);
            this.view = msg.v;
            this.isInViewChange = false;
            msg.O.forEach(msg => {
                // push pre-prepare
                this.extendVector2D(this.prePrepare, msg.v, msg.n);
                // pre-prepare[v][n] should only have one message
                if (this.prePrepare[msg.v][msg.n].length === 0) {
                    // re-consensus d
                    if (msg === undefined) { console.log("!! 343"); process.exit(0); }
                    this.prePrepare[msg.v][msg.n].push(msg);
                    this.digest[msg.d] = {
                        isReceived: true,
                        isPrepared: false,
                        isDecided: false,
                    };
                    this.registerTimeEvent(
                        { name: 'executeTimeout', params: { d: msg.d, v: msg.v } },
                        this.executeTimeout * 1000
                    );
                    // send prepare
                    const prepareMsg = {
                        type: 'prepare',
                        v: msg.v,
                        n: msg.n,
                        d: msg.d,
                        i: this.nodeID
                    };
                    this.extendVector2D(this.prepare, msg.v, msg.n);
                    this.prepare[msg.v][msg.n].push(prepareMsg);
                    // send when other nodes receive new-view
                    this.send(this.nodeID, 'broadcast', prepareMsg);
                }
                else {
                    console.log(`${this.nodeID}, view-change pre-prepare conflict`);
                    console.log('1', this.prePrepare[msg.v][msg.n][0]);
                    console.log('2', msg);
                    this.logger.warning(['view change pre-prepare conflict']);
                }
            });
            this.hasReceiveRequest = false;
            this.registerTimeEvent(
                {
                    name: 'receiveTimeout',
                    params: {
                        v: this.view
                    }
                },
                this.receiveTimeout * 1000
            );
            if (msg.prePrepareMsg) this.handlePrePrepareMsg(msg.prePrepareMsg);
            if (msg.prepareMsg) this.handlePrepareMsg(msg.prepareMsg);
        }
        else {
            this.logger.warning(['undefined msg type']);
        }
    }

    onTimeEvent(timeEvent) {
        super.onTimeEvent(timeEvent);
        const functionMeta = timeEvent.functionMeta;
        switch (functionMeta.name) {
            case 'start':
                this.start();
                break;
            case 'issueRequest':
                if (this.isPrimary) {
                    this.issueRequest();
                }
                break;
            case 'receiveTimeout':
                if (this.hasReceiveRequest) {
                    this.hasReceiveRequest = false;
                    this.registerTimeEvent(
                        {
                            name: 'receiveTimeout',
                            params: {
                                v: this.view
                            }
                        },
                        this.receiveTimeout * 1000
                    );
                }
                else if (!this.isInViewChange && this.view === functionMeta.params.v) {
                    this.logger.info(['did not receive any request']);
                    this.startViewChange(this.view + 1);
                }
                break;
            case 'executeTimeout':
                if (!this.digest[functionMeta.params.d].isDecided &&
                    !this.isInViewChange && functionMeta.params.v === this.view) {
                    this.logger.info([timeEvent.triggeredTime, 'not executed in time', functionMeta.params.d]);
                    this.startViewChange(this.view + 1);
                }
                break;
            case 'broadcastNewViewPrepare':
                this.newViewPrepareMsgs.forEach(
                    msg => this.send(this.nodeID, 'broadcast', msg)
                );
                break;
            case 'skipToNextView':
                if (functionMeta.params.oldView !== this.view) {
                    this.skipToNextView(functionMeta.params.oldView);
                }
                break;
            default:
                console.log('undefined function name');
                process.exit(0);
        }
    }

    // if the next primary is also dead
    skipToNextView(oldView) {
        if (this.view === this.oldView) {
            this.logger.info(['skip to next view']);
            const view = this.viewChangeMsg.v;
            this.viewChangeMsg.v = view + 1;
            this.extendVector(this.viewChange, view + 1);
            const tvc = JSON.parse(JSON.stringify(this.viewChangeMsg));
            this.viewChange[view + 1].push(tvc);
            this.send(this.nodeID, 'broadcast', tvc);
            this.viewChangeTimeout *= 2;
            this.executeTimeout *= 2;
            this.receiveTimeout *= 2;
            this.logger.info([`doubling timeout ${this.viewChangeTimeout} ${this.executeTimeout} ${this.receiveTimeout}`]);

            this.registerTimeEvent(
                { name: 'skipToNextView', params: { oldView: oldView } },
                this.viewChangeTimeout * 1000
            );
        }
    }

    startViewChange(nextView) {
        this.logger.info([`start a view change to ${nextView}`]);
        this.isInViewChange = true;

        const p = (this.prePrepare[this.view] === undefined) ? [] :
            this.prePrepare[this.view]
                .slice(this.lastStableCheckpoint + 1)
                .filter(msgArray => {
                    if (msgArray.length === 0) {
                        return false;
                    }
                    return this.digest[msgArray[0].d].isPrepared;
                })
                .map((msgArray) => {
                    const msg = msgArray[0];
                    return {
                        'pre-prepare': msg,
                        prepare: this.prepare[msg.v][msg.n]
                            .filter(_msg => _msg.d === msg.d)
                    };
                });
        this.viewChangeMsg = {
            type: 'view-change',
            v: nextView,
            n: this.lastStableCheckpoint,
            C: (this.lastStableCheckpoint <= 0) ? [] :
                this.checkpoint[this.lastStableCheckpoint]
                    .groupBy(msg => msg.d)
                    .maxBy(pair => pair[1].length)[1],
            P: p,
            i: this.nodeID
        };
        this.extendVector(this.viewChange, nextView);
        const tvc = JSON.parse(JSON.stringify(this.viewChangeMsg));
        this.viewChange[nextView].push(tvc);
        this.send(this.nodeID, 'broadcast', tvc);
        this.oldView = this.view;

        this.viewChangeTimeout *= 2;
        this.executeTimeout *= 2;
        this.receiveTimeout *= 2;
        this.logger.info([`doubling timeout view change timeout: ${this.viewChangeTimeout}, execute timeout: ${this.executeTimeout}, receive timeout: ${this.receiveTimeout}`]);
    }

    genRequest() {
        const request = uuid();
        this.digest[request] = {
            isReceived: true,
            isPrepared: false,
            isDecided: false,
        };
        const prePrepareMsg = {
            type: 'pre-prepare',
            v: this.view,
            n: this.seq,
            d: request,
            i: this.nodeID
        };
        this.extendVector2D(this.prePrepare, this.view, this.seq);
        this.prePrepare[this.view][this.seq].push(prePrepareMsg);

        const prepareMsg = {
            type: 'prepare',
            v: this.view,
            n: this.seq,
            d: request,
            i: this.nodeID
        };
        this.extendVector2D(this.prepare, this.view, this.seq);
        this.prepare[this.view][this.seq].push(prepareMsg);
        this.seq++;

        return [prePrepareMsg, prepareMsg];
    }

    issueRequest() {
        const [prePrepareMsg, prepareMsg] = this.genRequest();
        this.send(this.nodeID, 'broadcast', prePrepareMsg);
        // BUG! Leader doesn't need to broadcast prepare message
        this.send(this.nodeID, 'broadcast', prepareMsg);
    }

    start() {
        if (this.isPrimary) {
            this.issueRequest();
        }
        else {
            this.registerTimeEvent(
                {
                    name: 'receiveTimeout',
                    params: {
                        v: this.view
                    }
                },
                this.receiveTimeout * 1000
            );
        }

    }

    constructor(nodeID, nodeNum, network, registerTimeEvent) {
        super(nodeID, nodeNum, network, registerTimeEvent);
        this.f = Math.floor((this.nodeNum - 1) / 3);
        // pbft
        this.view = 0;
        this.isPrimary =
            (this.view % this.nodeNum) === (parseInt(this.nodeID) - 1);
        this.checkpointPeriod = 3;
        this.seq = 0;
        this.isInViewChange = false;
        this.proposePeriod = 2;
        this.lastDecidedSeq = -1;
        this.lastDecidedRequest = '';
        this.isDecided = false;
        // view change
        // check if a node receive a request in time
        this.lambda = config.lambda;
        this.receiveTimeout = 3 * this.lambda;
        this.hasReceiveRequest = false;
        this.executeTimeout = 3 * this.lambda;
        this.viewChangeTimeout = 2 * this.lambda;
        // this makes nodes create checkpoint at n = 0
        this.lastStableCheckpoint = 0;
        // log
        this.digest = {};
        this.prePrepare = [];
        this.prepare = [];
        this.commit = [];
        this.checkpoint = [];
        this.viewChange = [];
        this.registerTimeEvent({ name: 'start', params: {} }, 0);
    }
}

module.exports = PBFTNode;

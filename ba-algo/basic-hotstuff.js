'use strict';

const Node = require('./node');
const uuid = require('uuid/v4');
const config = require('../config');

const HotStuffMsgTypePrepare = 'hot-stuff-prepare';
const HotStuffMsgTypePreCommit = 'hot-stuff-pre-commit';
const HotStuffMsgTypeCommit = 'hot-stuff-commit';
const HotStuffMsgTypeDecide = 'hot-stuff-decide';
const HotStuffMsgTypeNextView = 'hot-stuff-next-view';
const HotStuffEventNextViewInterrupt = 'hot-stuff-next-view-interrupt';

function extendVector(v, n) {
    if (v[n] === undefined) {
        v[n] = [];
    }
}

// extend vector v to be able to access v[n][m] = array
function extendVector2D(v, n, m) {
    if (v[n] === undefined) {
        extendVector(v, n);
    }
    if (v[n][m] === undefined) {
        extendVector(v[n], m);
    }
}

function getPrimaryByView(view, nodeNum) {
    return (view % nodeNum + 1).toString();
}

class HotStuffNode extends Node {
    // safeNodePredicate
    checkMsgViewAndUpdateTimeout(msg, sourceReplica) {
        if (msg.type === HotStuffMsgTypeDecide) {
            return true;
        }
        if (msg.view != this.view) {
            this.logger.info(['dropping-msg', this.view, msg.view, JSON.stringify(msg), sourceReplica]);
            return false;
        }


        if (this.lockedQC.view === undefined || this.lockedQC.n === undefined) {
            // no lockedQC
            return true;
        }



        if (msg.n <= this.lockedQC.n && msg.reqeust !== this.lockedQC.reqeust && !(QC !== undefined && QC.view > this.lockedQC.n)) {
            // console.log("safenode prdicate", msg, this.lockedQC);
            this.logger.info(["locked", JSON.stringify(msg), JSON.stringify(this.lockedQC)]);
            return false;
        }

        // if (QC !== undefined && QC.view > this.view) {
        //     // to ensure liveness
        //     // if a replica see a QC with a higher view, it changes its mind.
        //     this.logger.info(['unlock', JSON.stringify(QC), JSON.stringify(msg)]);
        //     this.view = QC.view;
        //     this.registerNewNextViewInterrupt(msg);
        //     return true;
        // }


        // liveliness
        // this.logger.info([`update view from: ${this.view} to ${msg.view}`, JSON.stringify(msg)]);
        // this.view = msg.view;
        return true
    }

    registerNewNextViewInterrupt(msg) {
        this.currentNextViewInterruptUUID = uuid();
        // console.log("timeout", this.executeTimeout)
        this.logger.info(['extend-timeout', this.executeTimeout * 1000, this.currentNextViewInterruptUUID])
        this.registerTimeEvent({
            name: HotStuffEventNextViewInterrupt,
            params: { request: msg.request, view: msg.view, uuid: this.currentNextViewInterruptUUID }
        },
        this.executeTimeout * 1000);
    }

    isPrimary(view) {
        return getPrimaryByView(view, this.nodeNum) === this.nodeID;
    }

    // when primary receives enough vote on prepare
    sendPreCommit(msg) {
        // sending prepareQC and preCommit Msg
        let signers = this.prepare[msg.view][msg.n].filter(prepareMsg => prepareMsg.request === msg.request)
        .map(prepareMsg => {
            return prepareMsg.sourceReplica
        })
        const parepareQC = {
            n: msg.n,
            request: msg.request,
            view: msg.view,
            signers: signers,
        }

        const preCommitMsg = {
            type: HotStuffMsgTypePreCommit,
            view: msg.view,
            n: msg.n,
            request: msg.request,
            primary: this.nodeID,
            QC: parepareQC,
            sourceReplica: this.nodeID,
        };

        this.preCommitRequest(preCommitMsg)
        extendVector2D(this.preCommit, preCommitMsg.view, preCommitMsg.n);
        this.preCommit[preCommitMsg.view][preCommitMsg.n].push(preCommitMsg)
        this.send(this.nodeID, 'broadcast', preCommitMsg);
    }

    sendCommit(msg) {
        // send preCommit QC and commit msg
        // on receiving precommit QC, the replica should lock the value.
        // sending prepareQC and preCommit Msg
        let signers = this.preCommit[msg.view][msg.n].filter(preCommitMsg => preCommitMsg.request === msg.request)
            .map(preCommitMsg => {
                return preCommitMsg.sourceReplica
            });
        const preCommitQC = {
            n: msg.n,
            request: msg.request,
            view: msg.view,
            signers: signers,
        };
        const commitMsg = {
            type: HotStuffMsgTypeCommit,
            view: this.view,
            n: msg.n,
            request: msg.request,
            primary: this.nodeID,
            QC: preCommitQC,
            sourceReplica: this.nodeID,
        };
        this.commitRequest(commitMsg)
        extendVector2D(this.commit, commitMsg.view, commitMsg.n);
        this.commit[msg.view][msg.n].push(commitMsg)
        this.send(this.nodeID, 'broadcast', commitMsg);
    }

    sendDecideMsg(msg) {
        let signers = this.commit[msg.view][msg.n].filter(commitMsg => commitMsg.request === msg.request)
            .map(commitMsg => {
                return commitMsg.sourceReplica
            });
        const commitQC = {
            n: msg.n,
            request: msg.request,
            view: msg.view,
            signers: signers,
        };
        const decideMsg = {
            type: HotStuffMsgTypeDecide,
            n: msg.n,
            view: msg.view,
            request: msg.request,
            i: this.nodeID,
            QC: commitQC,
            sourceReplica: this.nodeID,
        };
        this.send(this.nodeID, 'broadcast', decideMsg);
    }

    processHotStuffDecide(msg, sourceReplica) {
        if (this.isRequestDecided(msg.view, msg.n)) {
            return;
        }
        // should verify wether the QC is valid.
        this.decideRequest(msg);
    }

    processHotStuffCommit(msg, sourceReplica) {
        // push commit
        extendVector2D(this.commit, msg.view, msg.n);
        msg.sourceReplica = sourceReplica
        if (this.commit[msg.view][msg.n].filter(m => m.sourceReplica === msg.sourceReplica).length == 0) {
            this.commit[msg.view][msg.n].push(msg);
        }

        // check committed local
        if (this.isPrimary(msg.view)) {
            if (this.commit[msg.view][msg.n].length >= this.nodeNum - this.f) {
                this.lastDecidedSeq = msg.n;
                this.lastDecidedRequest = msg.reqeust;
                this.logger.info(['decide', msg.request]);
                this.isDecided = true;
                //console.log(`${this.nodeID} decides`);
                if (!this.isRequestDecided(msg.view, msg.n)) {
                    this.decideRequest(msg)
                    this.sendDecideMsg(msg);

                }
            } 
            return;
        }
        if (!this.isRequestCommit(msg)) {
            this.commitRequest(msg);
            msg.sourceReplica = this.nodeID;
            this.send(this.nodeID, msg.primary, msg);
        }
    }

    processHotStuffPreCommit(msg, sourceReplica) {
        extendVector2D(this.preCommit, msg.view, msg.n);
        // save prepareQC
        msg.sourceReplica = sourceReplica;
        if (this.preCommit[msg.view][msg.n].filter(m => m.sourceReplica === msg.sourceReplica).length == 0) {
            this.preCommit[msg.view][msg.n].push(msg);
        }

        if(this.isPrimary(msg.view)) {
            if (this.preCommit[msg.view][msg.n].length >= this.nodeNum - this.f) {
                if (!this.isRequestCommit(msg.view, msg.n)) {
                    this.sendCommit(msg)
                }
            } 
            return
        }

        if (!this.isRequestPrecommit(msg.view, msg.n)) {
            this.preCommitRequest(msg);
            msg.sourceReplica = this.nodeID;
            this.send(this.nodeID, msg.primary, msg);
        }
    }

    processHotStuffPrepare(msg, sourceReplica) {

        extendVector2D(this.prepare, msg.view, msg.n)
        // msg.sourceReplica = sourceReplica
        if (this.prepare[msg.view][msg.n].filter(m => m.sourceReplica === msg.sourceReplica).length == 0) {
            this.prepare[msg.view][msg.n].push(msg)
        }

        if (this.isPrimary(msg.view)) {
            // todo: we make sure the msg have collected enough votes by checking the threshold sig
            if(this.prepare[msg.view][msg.n].filter(m => {return m.request === msg.request}).length >= this.nodeNum - this.f) {
                if (!this.isRequestPrecommit(msg.view, msg.n)) {
                    this.sendPreCommit(msg)
                }
            }
            return
        }
        if (!this.isRequestPrepared(msg.view, msg.n)) {
            this.prepareRequest(msg);
            msg.sourceReplica = this.nodeID;
            this.send(this.nodeID, msg.primary, msg);
        }
    }

    onMsgEvent(msgEvent) {
        super.onMsgEvent(msgEvent);
        const msg = msgEvent.packet.content;
        this.logger.info(['recv',
            this.logger.round(msgEvent.triggeredTime),
            JSON.stringify(msg)]);
        if (!this.checkMsgViewAndUpdateTimeout(msg, msgEvent.packet.src)) {
            return;
        }
        if (msg.type === HotStuffMsgTypePrepare) {
            return this.processHotStuffPrepare(msg, msgEvent.packet.src);
        } else if (msg.type === HotStuffMsgTypePreCommit) {
            return this.processHotStuffPreCommit(msg, msgEvent.packet.src);
        } else if (msg.type === HotStuffMsgTypeCommit) {
            return this.processHotStuffCommit(msg, msgEvent.packet.src);
        } else if (msg.type === HotStuffMsgTypeDecide) {
            return this.processHotStuffDecide(msg, msgEvent.packet.src);
        } else if (msg.type === HotStuffMsgTypeNextView) {
            return this.processHotStuffNextViewMsg(msg, msgEvent.packet.src);
        } else {
            this.logger.warning(['undefined msg type']);
        }
    }

    onTimeEvent(timeEvent) {
        super.onTimeEvent(timeEvent);
        const functionMeta = timeEvent.functionMeta;
        // console.log('receiving time event', timeEvent)
        switch (functionMeta.name) {
            case 'start':
                this.start();
                break;
            case 'issueRequest':
                if (this.isPrimary(this.view)) {
                    this.issueRequest();
                }
                break;
            case HotStuffEventNextViewInterrupt:
                if (this.currentNextViewInterruptUUID !== undefined  &&
                    this.currentNextViewInterruptUUID !== functionMeta.params.uuid) {
                        break;
                    }
                this.logger.info([timeEvent.triggeredTime, 'not executed in time', JSON.stringify(functionMeta.params)]);
                this.hotStuffViewChange(functionMeta.params);
                break;
            default:
                console.log('undefined function name');
                process.exit(0);
        }
    }


    hotStuffViewChange(params) {
        this.logger.info([`start a view change to ${this.view+1}`]);
        this.logger.info([`doubling timeout ${this.executeTimeout}`]);
        this.executeTimeout *= 2;
        this.view++;
        const nextPrimary = getPrimaryByView(this.view, this.nodeNum);
        const nextViewMsg = {
            type: HotStuffMsgTypeNextView,
            view: this.view,
            QC: this.highQC,
            n: this.seq,
            sourceReplica: this.nodeID,
        }
        if (nextPrimary === this.nodeID) {
            this.processHotStuffNextViewMsg(nextViewMsg, this.nodeID);
        } else {
            extendVector2D(this.nextView, nextViewMsg.view, nextViewMsg.n);
            this.nextView[nextViewMsg.view][nextViewMsg.n].push(nextViewMsg);
            this.send(this.nodeID, nextPrimary.toString(), nextViewMsg);
        }
        this.registerNewNextViewInterrupt(nextViewMsg);
    }

    processHotStuffNextViewMsg(msg, sourceReplica) {
        if (getPrimaryByView(msg.view, this.nodeNum) !== this.nodeID){
            return;
        }

        extendVector(this.nextView, msg.view);
        msg.sourceReplica = sourceReplica;
        if (this.nextView[msg.view].filter(m => m.sourceReplica === msg.sourceReplica).length == 0) {
            this.nextView[msg.view].push(msg);
        }

        if (this.nextView[msg.view].length >= this.nodeNum - this.f) {
            if (!this.isIssueRequest(msg.view)) {
                this.issueRequest(msg.view);
                this.setIssueRequest(msg.view);
            }
        }
    }

    setIssueRequest(view) {
        this.isBroadcast[view] = true;
    }
    isIssueRequest(view) {
        if (this.isBroadcast[view] === true) {
            return true;
        }
        return false;
    }

    receiveRequest(msg) {
        this.localCommandMap[msg.n] = msg.request;
        extendVector2D(this.digest, msg.view, msg.n);
        if (this.digest[msg.view][msg.n] === undefined) {
            this.digest[msg.view][msg.n] = {};
            // // work around
            // if(this.seq != msg.n) {
            //     this.seq = msg.n;
            // }
        }
        this.digest[msg.view][msg.n].isReceived = true
    }

    updateHighQC(QC) {
        if(this.highQC === undefined) {
            this.highQC = QC;
        }
        if (QC.view > this.highQC.view) {
            this.highQC = QC;
        }
    }

    prepareRequest(msg) {
        this.localCommandMap[msg.n] = msg.request;
        extendVector2D(this.digest, msg.view, msg.n);
        if (this.digest[msg.view][msg.n] === undefined) {
            this.digest[msg.view][msg.n] = {};
        }
        this.digest[msg.view][msg.n].isPrepared = true

        this.logger.info(['prepare-request', `prepare request: ${JSON.stringify(msg)}`]);
    }

    commitRequest(msg) {
        extendVector2D(this.digest, msg.view, msg.n);
        if (this.digest[msg.view][msg.n] === undefined) {
            this.digest[msg.view][msg.n] = {};
        }
        this.digest[msg.view][msg.n].isCommit = true;
        this.logger.info(['locked QC', JSON.stringify(msg)])
        this.lockedQC = msg.QC;
    }

    preCommitRequest(msg) {
        extendVector2D(this.digest, msg.view, msg.n);
        if (this.digest[msg.view][msg.n] === undefined) {
            this.digest[msg.view][msg.n] = {};
        }
        this.digest[msg.view][msg.n].isPreCommit = true;
        if (msg.QC !== undefined) {
            this.updateHighQC(msg.QC);
        }
    }



    decideRequest(msg) {
        extendVector2D(this.digest, msg.view, msg.n);
        if (this.digest[msg.view][msg.n] === undefined) {
            this.digest[msg.view][msg.n] = {};
        }
        this.digest[msg.view][msg.n].isDecided = true;
        this.logger.info(['decide', JSON.stringify(msg)]);
        this.seq++;

        this.lastDecidedSeq = msg.n;
        this.lastDecidedRequest = msg.reqeust;
        this.logger.info(['decide', msg.request, this.decideCount]);
        this.isDecided = true;
        this.decideCount++;
        this.executeTimeout = 1;
        if (this.isPrimary(this.view)) {
            this.issueRequest();
        }
        this.registerNewNextViewInterrupt(msg);
    }


    isRequestRecived(view, n) {
        extendVector2D(this.digest, view, n);
        if (this.digest[view][n] !== undefined && this.digest[view][n].isReceived) {
            return true;
        }
        return false;
    }

    isRequestCommit(view, n) {
        extendVector2D(this.digest, view, n);
        if (this.digest[view][n] !== undefined && this.digest[view][n].isCommit) {
            return true;
        }
        return false;
    }

    isRequestPrecommit(view, n) {
        extendVector2D(this.digest, view, n);
        if (this.digest[view][n] !== undefined && this.digest[view][n].isPreCommit) {
            return true;
        }
        return false;
    }


    isRequestPrepared(view, n) {
        extendVector2D(this.digest, view, n);
        if (this.digest[view][n] !== undefined && this.digest[view][n].isPrepared) {
            return true;
        }
        return false;
    }

    isRequestDecided(view, n) {
        extendVector2D(this.digest, view, n);
        if (this.digest[view][n] !== undefined && this.digest[view][n].isDecided) {
            return true;
        }
        return false;
    }

    issueRequest(view) {
        let request = uuid();
        if (this.nextView[view] !== undefined  &&
            this.nextView[view].length >= this.nodeNum - this.f) {
            // should get the highest n from all prepare QC
            const maxNMsg = this.nextView[this.view].maxBy(msg => {
                if(msg.QC !== undefined) {
                    return msg.QC.n;
                }
                return -1;
            });
            this.logger.info(['maxNMSG', JSON.stringify(maxNMsg)]);
            if (maxNMsg.QC !== undefined && maxNMsg.QC.request !== undefined) {
                request = maxNMsg.QC.request;
                this.updateHighQC(maxNMsg.QC);
            }
        }

        const hotStuffPrepareMsg = {
            type: HotStuffMsgTypePrepare,
            view: this.view,
            n: this.seq,
            request: request,
            primary: this.nodeID,
            sourceReplica: this.nodeID,
            QC: this.highQC,
        };


        this.prepareRequest(hotStuffPrepareMsg)
        extendVector2D(this.prepare, this.view, hotStuffPrepareMsg.n);
        this.prepare[hotStuffPrepareMsg.view][hotStuffPrepareMsg.n].push(hotStuffPrepareMsg);
        this.send(this.nodeID, 'broadcast', hotStuffPrepareMsg);
    }

    start() {
        if (this.isPrimary(this.view)) {
            this.issueRequest();
        }
        const msg = {
        }
        this.registerNewNextViewInterrupt(msg)
    }

    constructor(nodeID, nodeNum, network, registerTimeEvent) {
        super(nodeID, nodeNum, network, registerTimeEvent);
        this.f = (this.nodeNum % 3 === 0) ?
            this.nodeNum / 3 - 1 : Math.floor(this.nodeNum / 3);
        // pbft
        this.view = 0;
        this.seq = 0;
        // view change
        // check if a node receive a request in time
        this.lambda = config.lambda;
        this.executeTimeout = this.lambda;
        // this makes nodes create checkpoint at n = 0
        this.lastStableCheckpoint = 0;
        // log
        this.digest = {};
        this.prepare = [];
        this.preCommit = [];
        this.commit = [];
        this.viewChange = [];
        this.prepareQC = {};
        this.lockedQC = {};
        this.nextView = {};
        this.localCommandMap = {};
        this.highestRequestEventView = {};
        this.isBroadcast = {}
        this.decideCount = 0;
        this.registerTimeEvent({ name: 'start', params: {} }, 0);
    }
}
//const n = new PBFTNode(process.argv[2], process.argv[3]);
module.exports = HotStuffNode;
'use strict';

const Node = require('./node');
const uuid = require('uuid/v4');
let config = require('../config');

const HotStuffMsgTypeNextView = 'hot-stuff-next-view';
const HotStuffEventNextViewInterrupt = 'hot-stuff-next-view-interrupt';
const HotStuffMsgTypeUpdate = 'hot-stuff-update';
const TimeOutMSG = 'pacemaker-timeout-msg';

const HotStuffGenesisQC = {
    view: -1,
    request: 'hot-stuff-genesis-null-QC',
}

const HotStuffGenesisBlock = {
    view: -1,
    request: 'hot-stuff-genesis-block',
    QC: HotStuffGenesisQC,
};


function extendVector(v, n) {
    if (v[n] === undefined) {
        v[n] = [];
    }
}

function getPrimaryByView(view, nodeNum) {
    return ((view + nodeNum) % nodeNum + 1).toString();
}

class HotStuffTMNode extends Node {

    getBlockVotesNum(msg) {
        const votesNum = this.blockVotes[msg.view].
            filter(m => m.request === msg.request).
            groupBy(m => m.sourceReplica).length;
        return votesNum;
    }

    getBlockRequest(n) {
        if (n == 0) {
            return HotStuffGenesisQC;
        }
        if (n < 0) {
            console.log(`error when querying block: ${n}`);
            return undefined;
        }
        if (this.localBlocks === undefined) {
            console.log(`error when querying block: ${n}`);
            return undefined;
        }
        return this.localBlocks[n].request;
    }

    // since leaders generate a new request from uuid(), we used it as block identifier (blockhash)
    getBlockByRequest(request) {
        if (this.localBlocksMap === undefined) {
            this.localBlocksMap = {};
        }
        return this.localBlocksMap[request];
    }

    insertBlockByRequest(block) {
        if (this.localBlocksMap === undefined) {
            this.localBlocksMap = {};
        }
        if (block.dummyBlocks !== undefined) {
            if (block.dummyBlocks.length > 0) {
                block.dummyBlocks.forEach(dummyBlock => {
                    this.logger.info(['insert dummy', JSON.stringify(dummyBlock)]);
                    this.insertBlockByRequest(dummyBlock);
                });
            }
            // delete block.dummyBlocks;
        }

        this.logger.info(['inserting-block', JSON.stringify(block)])
        this.localBlocksMap[block.request] = block;
        if (this.localBlocksRequestMap[block.view] === undefined) {
            this.localBlocksRequestMap[block.view] = []
        }
        this.localBlocksRequestMap[block.view].push(block.request);
    }

    generateTMQC(view) {
        if (this.nextView[view] === undefined) {
            console.log('error');
        }
        let signers = this.block = this.nextView[view].map(m => {
            return m.sourceReplica
        })
        if (signers.length < this.nodeNum - this.f) {
            console.log("generated QC with insufficient signatures");
            process.exit(0);
        }
        const TMQC = {
            request: PaceMakerTimeOutQC,
            signers: signers,
            view: view,
        }
    }

    generateQC(msg) {
        // work as a threshold signautre
        let signers = this.blockVotes[msg.view]
            .filter(m => m.request === msg.request)
            .map(m => {
                return m.sourceReplica
            })
        if (signers.length < this.nodeNum - this.f) {
            console.log("generated QC with insufficient signatures");
            process.exit(0);
        }
        const QC = {
            request: msg.request,
            view: msg.view,
            signers: signers,
        };
        return QC;
    }


    // paceMaker
    updateQCHigh(QC) {
        if (this.highQC === HotStuffGenesisQC || QC.view > this.highQC.view) {
            this.registerNewNextViewInterrupt();
            this.highQC = QC;
        }
    }

    updateLockQC(QC) {
        if (this.lockedQC === HotStuffGenesisQC || QC.view > this.lockedQC.view) {
            this.lockedQC = QC;
            this.logger.info(['locked-QC', JSON.stringify(QC)]);
        }
    }

    isBroadcast(view) {

        if (this.isBroadcastMap[view] !== undefined) {
            return true;
        }
        return false;
    }
    
    setBroadcast(view) {

        this.isBroadcastMap[view] = true;
    }

    receiveVote(msg) {
        if(msg.view < this.lastVotedView) {
            return;
        }
        extendVector(this.blockVotes, msg.view);
        if (this.blockVotes[msg.view].filter(m => m.sourceReplica === msg.sourceReplica).length === 0) {
            this.blockVotes[msg.view].push(msg);
        }
        if (this.getBlockVotesNum(msg) >= this.nodeNum - this.f) {
            if (!this.isBroadcast(msg.view)) {
                this.logger.info(['enough vote', JSON.stringify(msg)]);
                const QC = this.generateQC(msg);
                this.updateQCHigh(QC);
                this.setBroadcast(msg.view);
                this.proposeNextRequest(msg.view);                
            }
        }
    }

    getBlockRequestByView(view) {
        if (this.localBlocksRequestMap === undefined) {
            this.localBlocksRequestMap = {};
        }
        if (this.localBlocksRequestMap[view] !== undefined) {
            return this.localBlocksRequestMap[view][0];
        }
        return undefined;
    }

    generateDummyBlock(QC, view) {
        let parentRequest = QC.request;
        let dummyBlocks = [];
        for (let v = QC.view + 1; v <= view; v++) {
            let block = {
                view: v,
                request: uuid(),
                QC: QC,
                parent: parentRequest,
            }
            dummyBlocks.push(block);
            parentRequest = block.request;
        }
        return dummyBlocks.reverse();
    }

    proposeNextRequest(view) {
        // console.log("propose next request", this.view, this.lastVotedView, this.nodeID);
        if (this.isPrimary(view)) {
            let parentBlock = this.getBlockRequestByView(view);
            let dummyBlocks;
            if (parentBlock === undefined) {
                // this.logger.info(['generating-dummy-block', JSON.stringify(this.highQC), view])
                dummyBlocks = this.generateDummyBlock(this.highQC, view);
                // this.logger.info(['dummy', JSON.stringify(dummyBlocks)]);
                if (dummyBlocks.length > 0) {
                    parentBlock = dummyBlocks[0].request;
                }
            }

            const msg = {
                type: HotStuffMsgTypeUpdate,
                view: view + 1,
                request: uuid(),
                primary: getPrimaryByView(view + 1, this.nodeNum),
                dummyBlocks: dummyBlocks,
                QC: this.highQC,
                parent: parentBlock,
                sourceReplica: this.nodeID,
            }
            extendVector(this.blockVotes, view + 1);
            this.blockVotes[view + 1].push(msg);

            this.lastVotedView = view + 1;

            this.send(this.nodeID, 'broadcast', msg);
            this.updateBlock(msg);
        }
    }

    isAncestor(block, lockedQC) {
        let curBlock = block;
        while (curBlock.view > lockedQC.view) {
            let nextBlock = this.getBlockByRequest(curBlock.parent);
            if(nextBlock === undefined) {
                this.logger.info(['missing-parent-block', JSON.stringify(curBlock)]);
                return false;
            }
            curBlock = nextBlock;
        }
        if (curBlock.view !== lockedQC.view || curBlock.request !== lockedQC.request) {
            return false;
        }
        return true;
    }

    updateBlock(msg) {
        this.insertBlockByRequest(msg);
        if (msg.QC === undefined) {
            return false;
        }
        this.updateQCHigh(msg.QC);

        let parentBlock = this.getBlockByRequest(msg.QC.request);

        if (parentBlock === undefined || parentBlock.QC === undefined) {
            return false;
        }
        this.updateLockQC(parentBlock.QC);

        let grandParentBlock = this.getBlockByRequest(parentBlock.QC.request);

        if (grandParentBlock === undefined || grandParentBlock.QC === undefined ||
            grandParentBlock.parent !== grandParentBlock.QC.request ||
            parentBlock.parent !== parentBlock.QC.request) {
            // Do not commit the block if it doesn't form a three-chained
            return false;
        }
        
        // decide
        this.commitBlock(grandParentBlock.QC.request);
    }

    commitBlock(request) {
        let block = this.getBlockByRequest(request);
        if (block === undefined) {
            this.logger.info(['missing-block', 'decide', request]);
            return;
        }
        // console.log("commit", block, this.lastExecView)
        if (this.lastExecView < block.view) {
            if (block.parent !== undefined && block.parent != HotStuffGenesisQC) {
                this.commitBlock(block.parent);
            }
            this.logger.info(['decide', JSON.stringify(block)]);
            this.lastExecView = block.view;
            if (block.QC.request === block.parent) {
                this.decideCount++;
                if (this.decideCount >= 100) {
                    this.isDecided = true;
                }
            }
            this.executeTimeout = this.lambda;
        }
    }
 
    voteOnBlock(msg) {
        if (this.isVote[msg.view] === true) {
            return;
        }
        extendVector(this.blockVotes, msg.view);

        const voteMsg = {
            type: HotStuffMsgTypeUpdate,
            view: msg.view,
            request: msg.request,
            primary: msg.primary,
            QC: msg.QC,
            sourceReplica: this.nodeID,
        }
        msg.sourceReplica = this.nodeID;
        if (this.blockVotes[msg.view].filter(m => m.sourceReplica === msg.sourceReplica).length === 0) {
            this.blockVotes[msg.view].push(msg);
        }
        if (this.nodeID !== getPrimaryByView(msg.view, this.nodeNum)) {
            this.send(this.nodeID, getPrimaryByView(msg.view, this.nodeNum), msg);
        }
        this.lastVotedView = msg.view;
    }

    onReceiveProposal(msg) {
        // a replica only votes on the first proposal it receives.
        if (msg.view < this.lastVotedView) {
            this.logger.info(['drop-msg', JSON.stringify(msg)]);
            return;
        }
        if (msg.tmQC !== undefined){
           this.advanceViewByQC(QC);
        }
            // accepting a QC with a higher view than lockedQC to ensure liveness.
            // rejecting blocks contradict to locked QC to ensure safety.

            this.updateBlock(msg);
            if (msg.QC.view > this.lockedQC.view || this.isAncestor(msg, this.lockedQC)) {
                this.voteOnBlock(JSON.parse(JSON.stringify(msg)));
            }
        

    }

    processUpdateMsg(msg) {
        this.onReceiveProposal(msg);
        if (this.isPrimary(msg.view)) {
            return this.receiveVote(msg);
        }
    }


    registerNewNextViewInterrupt() {
        this.currentNextViewInterruptUUID = uuid();
        // console.log("timeout", this.executeTimeout)
        this.registerTimeEvent({
            name: HotStuffEventNextViewInterrupt,
            params: { uuid: this.currentNextViewInterruptUUID }
        },
            this.executeTimeout * 1000);
    }

    onMsgEvent(msgEvent) {
        super.onMsgEvent(msgEvent);
        const msg = msgEvent.packet.content;
        this.logger.info(['recv',
            this.logger.round(msgEvent.triggeredTime),
            JSON.stringify(msg)]);
        // if (!this.checkMsgViewAndUpdateTimeout(msg, msgEvent.packet.src)) {
        //     return;
        // }
        if (msg.type === HotStuffMsgTypeUpdate) {
            return this.processUpdateMsg(msg);
        } else if (msg.type === HotStuffMsgTypeNextView) {
            return this.processHotStuffNextViewMsg(msg, msgEvent.packet.src);
        } else {
            this.logger.warning(['undefined msg type']);
        }
    }

    isPrimary(view) {
        return getPrimaryByView(view, this.nodeNum) === this.nodeID;
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
                if (this.isPrimary(this.lastVotedView+1)) {
                    this.proposeNextRequest(this.lastVotedView + 1);
                }
                break;

            // Libra paceMaker:
            // process local timeout
            case HotStuffEventNextViewInterrupt:
                if (this.currentNextViewInterruptUUID !== undefined &&
                    this.currentNextViewInterruptUUID !== functionMeta.params.uuid) {
                    break;
                }
                this.hotStuffViewChange();
                break;
            default:
                console.log('undefined function name');
                process.exit(0);
        }
    }


    // Libra paceMaker:
    // proess local timeout
    hotStuffViewChange() {
        this.logger.info([`skip a view ${this.lastVotedView}`]);
        this.logger.info([`doubling timeout ${this.executeTimeout}`]);
        this.lastVotedView ++;
        this.executeTimeout *= 2;
        this.view++;
        

        const nextPrimary = getPrimaryByView(this.lastVotedView, this.nodeNum);
        // Similar to timeout QC in Libra
        const msg = {
            type: HotStuffMsgTypeNextView,
            view: this.lastVotedView,
            primary: nextPrimary,
            QC: this.highQC,
            sourceReplica: this.nodeID,
        }
        if (this.nextView[msg.view] === undefined) {
            this.nextView[msg.view] = [];
        }
        this.nextView[msg.view].push(msg);
        this.registerNewNextViewInterrupt(msg);
        this.send(this.nodeID, 'broadcast', msg);
        this.processHotStuffNextViewMsg(msg, this.nodeID);
    }

    // paceMaker: advance_round
    advanceViewByQC(QC) {
        if (QC.view < this.lastVotedView) {
            return;
        } 
        this.logger.info(['advance-view', JSON.stringify(QC)]);
        this.lastVotedView = QC.view + 1;
        const primary = getPrimaryByView(QC.view, this.nodeNum);
        if (this.nodeID != primary) {
            // send QC to primary
            const msg = {
                type: HotStuffMsgTypeNextView,
                view: QC.view,
                primary: primary,
                QC: QC,
                sourceReplica: this.nodeID,
            }
            if (this.nextView[msg.view] === undefined) {
                this.nextView[msg.view] = [];
            }
            this.nextView[msg.view].push(msg);
            this.registerNewNextViewInterrupt(msg);
            this.send(this.nodeID, primary, msg);
        }
    }

    // This is the combination of two function
    // nextViewMsg in hotstuff and process remotetimeout in Libra's pacemaker
    processHotStuffNextViewMsg(msg, sourceReplica) {
        if (msg.view < this.lastVotedView) {
            return;
        }

        this.logger.info(['process-next-view', JSON.stringify(msg)]);
        // if (!this.isPrimary(msg.view)) {
        //     return;
        // }
        if (this.nextView[msg.view] === undefined) {
            this.nextView[msg.view] = [];
        }
        msg.sourceReplica = sourceReplica;
        if (this.nextView[msg.view].filter(m => m.sourceReplica === msg.sourceReplica).length == 0) {
            this.nextView[msg.view].push(msg);
        }

        if (this.nextView[msg.view].length >= this.nodeNum - this.f) {
            // process remote QC
            this.logger.info(['process-remote qc', JSON.stringify(msg)])
            const QC = {
                view: msg.view,
                request: 'pacemaker-timeout-QC',
            }
            if (this.isPrimary(msg.view)){
                this.proposeNextRequest(msg.view);
            } else {
                this.advanceViewByQC(QC);
            }
        }
    }

    start() {
        if (this.isPrimary(this.lastVotedView )) {
            this.proposeNextRequest(this.lastVotedView);
        }
    }

    constructor(nodeID, nodeNum, network, registerTimeEvent, customized_config) {
        super(nodeID, nodeNum, network, registerTimeEvent);
        if (customized_config !== undefined) {
            config = customized_config;
        }
        this.f = (this.nodeNum % 3 === 0) ?
            this.nodeNum / 3 - 1 : Math.floor(this.nodeNum / 3);
        // check if a node receive a request in time
        this.lambda = config.lambda;
        this.executeTimeout = this.lambda;
        // log

        this.viewChange = [];

        this.isDecided = false;
        this.lastVotedView = -1;
        this.lastExecView = -1;
        this.localBlocksRequestMap = {};

        this.prepareQC = HotStuffGenesisQC;
        this.lockedQC = HotStuffGenesisQC;
        this.commitQC = HotStuffGenesisQC;
        this.highQC = HotStuffGenesisQC;

        this.isBroadcastMap = {};
        this.blockVotes = {};
        // this.isBroadcastMap = {};

        this.decideCount = 0;
        this.blockVotes = {};
        this.isVote = {};

        this.insertBlockByRequest(HotStuffGenesisQC);
        this.nextView = {};
        this.registerNewNextViewInterrupt();
        this.registerTimeEvent({ name: 'start', params: {} }, 0);
    }
}
//const n = new PBFTNode(process.argv[2], process.argv[3]);
module.exports = HotStuffTMNode;

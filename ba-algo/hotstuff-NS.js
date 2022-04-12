'use strict';

const Node = require('./node');
const uuid = require('uuid/v4');
let config = require('../config');

const msgType = {
    vote: 'hot-stuff-vote',
    proposal: 'hot-stuff-proposal'
}
const eventType = {
    start: 'start',
    nextViewInterrupt: 'hot-stuff-next-view-interrupt',
}

const extendVector = (v, n) => { if (v[n] === undefined) v[n] = []; }

class HotStuffNode extends Node {

    // util

    newQC = (request, view, height, signers) => ({
        request, view, height, signers
    });
    newProposal = (height, view, src, request, QC, primary, dummyBlocks, parent) => ({
        type: msgType.proposal, height, view, src, request, QC, primary, dummyBlocks, parent
    });
    newVote = (view, src, request, QC) => ({
        type: msgType.vote, view, src, request, QC
    });

    insertBlock(block) {
        if (block.dummyBlocks !== undefined && block.dummyBlocks.length > 0) {
            block.dummyBlocks.forEach(dummyBlock => {
                this.logger.info(['insert dummy', JSON.stringify(dummyBlock)]);
                this.insertBlock(dummyBlock);
            });
        }

        this.logger.info(['inserting-block', JSON.stringify(block)])
        this.blocks[block.request] = block;
        if (!this.heightToBlock[block.height]) this.heightToBlock[block.height] = block.request;
    }

    castVote = (vote) => {
        extendVector(this.ballots, vote.request);
        if (this.ballots[vote.request].every(m => m.src !== vote.src)) {
            this.ballots[vote.request].push(vote);
            return true;
        }
        return false;
    }

    getBlockVotesNum = (req) => this.ballots[req] ? this.ballots[req].length : 0;

    generateQC(block) {
        let signers = this.ballots[block.request].map(m => m.src);
        return this.newQC(block.request, block.view, block.height, signers);
    }

    generateDummyBlock(QC, height) {
        let parent = QC.request;
        let dummyBlocks = [];
        for (let h = QC.height + 1; v <= height; v++) {
            let block = this.newProposal(h, this.view, this.nodeID, uuid(), QC, this.nodeID, [], parent);
            dummyBlocks.push(block);
            parent = block.request;
        }
        return dummyBlocks.reverse();
    }

    isAncestor(block, root) {
        let curBlock = block;
        while (curBlock.height > root.height) {
            let nextBlock = this.blocks[curBlock.parent];
            if (nextBlock === undefined) {
                this.logger.info(['missing-parent-block', JSON.stringify(curBlock)]);
                return false;
            }
            curBlock = nextBlock;
        }
        return curBlock.height === root.height && curBlock.request === root.request;
    }

    // core protocol (leader)

    proposeNextRequest() {
        let parent = this.heightToBlock[this.vheight];
        let dummyBlocks;
        if (parent === undefined) {
            dummyBlocks = this.generateDummyBlock(this.highQC, this.vheight);
            if (dummyBlocks.length > 0) {
                parent = dummyBlocks[0].request;
            }
        }

        const proposal = this.newProposal(
            this.vheight+1, this.view, this.nodeID, uuid(), this.highQC, this.nodeID, dummyBlocks, parent
        );
        this.voteOnBlock(proposal);

        this.send(this.nodeID, 'broadcast', proposal);
        this.updateBlock(proposal);
    }

    receiveVote(vote) {
        if (vote.height < this.vheight) return;

        const block = this.blocks[vote.request];
        if (this.castVote(vote) && this.getBlockVotesNum(block.request) === this.nodeNum - this.f) {
            this.logger.info([`${Math.round(this.clock)}`, 'enough vote', JSON.stringify(vote)]);
            const QC = this.generateQC(block);
            this.updateQCHigh(QC);
            if (this.isPrimary(this.view)) this.proposeNextRequest();
        }
    }

    // core protocol (replica)

    safeNode = (msg) => msg.QC.height > this.lockedQC.height || this.isAncestor(msg, this.lockedQC);

    onReceiveProposal(proposal) {
        this.updateBlock(proposal);
        if (proposal.view !== this.view) {
            this.logger.warning(["Received a proposal not from the current leader"]);
            return;
        }
        if (proposal.height <= this.vheight) {
            this.logger.warning(["Received a proposal before current height"]);
            return;
        }
        if (this.safeNode(proposal)) this.voteOnBlock(proposal);
    }

    voteOnBlock(proposal) {
        const vote = this.newVote(proposal.view, this.nodeID, proposal.request, proposal.QC);
        this.castVote(vote);
        if (this.nodeID !== this.getPrimary(proposal.view)) {
            this.send(this.nodeID, this.getPrimary(proposal.view), vote);
        }
        this.vheight = proposal.height;
    }

    updateBlock(proposal) {
        this.insertBlock(proposal);
        if (proposal.QC === undefined) {
            return false;
        }
        
        this.updateQCHigh(proposal.QC);

        let parentBlock = this.blocks[proposal.QC.request];
        if (parentBlock === undefined || parentBlock.QC === undefined) {
            return false;
        }
        this.updateLockQC(parentBlock.QC);

        let grandParentBlock = this.blocks[parentBlock.QC.request];
        if (grandParentBlock === undefined || grandParentBlock.QC === undefined ||
            grandParentBlock.parent !== grandParentBlock.QC.request ||
            parentBlock.parent !== parentBlock.QC.request) {
            // Do not commit the block if it doesn't form a three-chained
            return false;
        }

        // decide
        this.commitBlock(grandParentBlock.QC.request);
        this.lastExecHeight = grandParentBlock.QC.height;
    }

    commitBlock(request) {
        this.logger.info([`Commit ${request}`]);
        const block = this.blocks[request];
        if (block === undefined) {
            this.logger.info(['missing-block', 'decide', request]);
            return;
        }
        if (this.lastExecHeight < block.height) {
            // recursivly commit parent blocks
            if (block.parent) this.commitBlock(block.parent);            
            
            this.logger.info(['decide', JSON.stringify(block)]);
            this.decideCount++;
            if (this.decideCount >= 100) this.isDecided = true;
            this.executeTimeout = this.lambda;
            this.logger.info([`${Math.round(this.clock)}`, `Node ${this.nodeID} reset timeout at view ${this.view}`]);
            this.registerNewNextViewInterrupt();
        }
    }

    updateQCHigh(QC) {
        if (this.highQC === this.GenesisQC || QC.height > this.highQC.height) {
            this.highQC = QC;
        }
    }

    updateLockQC(QC) {
        if (this.lockedQC === this.GenesisQC || QC.height > this.lockedQC.height) {
            this.lockedQC = QC;
            this.logger.info(['locked-QC', JSON.stringify(QC)]);
        }
    }

    // pacemaker

    registerNewNextViewInterrupt() {
        this.currNextViewInterrupt = uuid();
        this.registerTimeEvent({
            name: eventType.nextViewInterrupt,
            params: { uuid: this.currNextViewInterrupt }
        },
            this.executeTimeout * 1000
        );
    }

    viewChange() {
        this.view++;
        this.executeTimeout *= 2;
        this.logger.info([`${Math.round(this.clock)}`, `enter a new view ${this.view}, doubling timeout to ${this.executeTimeout}`]);
        this.registerNewNextViewInterrupt();

        if (this.isPrimary(this.view)) return this.proposeNextRequest();
    }

    getPrimary = (view) => `${(view % this.nodeNum) + 1}`;
    isPrimary  = (view) => this.getPrimary(view) === this.nodeID;

    // simulator related API

    onMsgEvent(msgEvent) {
        super.onMsgEvent(msgEvent);
        const msg = msgEvent.packet.content;
        this.logger.info(['recv',
            this.logger.round(msgEvent.triggeredTime),
            JSON.stringify(msg)
        ]);
        switch (msg.type) {
            case msgType.vote:
                return this.receiveVote(msg);
            case msgType.proposal:
                return this.onReceiveProposal(msg);
            default:
                this.logger.warning(['undefined msg type']);
        }
    }

    onTimeEvent(timeEvent) {
        super.onTimeEvent(timeEvent);
        const meta = timeEvent.functionMeta;
        switch (meta.name) {
            case eventType.nextViewInterrupt:
                if (this.currNextViewInterrupt !== meta.params.uuid) break;
                this.viewChange();
                break;
            case 'start':
                if (this.isPrimary(this.view)) this.proposeNextRequest();
                break;
            default:
                console.log('undefined function name');
                process.exit(0);
        }
    }

    constructor(nodeID, nodeNum, network, registerTimeEvent, customized_config) {
        super(nodeID, nodeNum, network, registerTimeEvent);
        if (customized_config !== undefined) {
            config = customized_config;
        }
        this.f = Math.floor((this.nodeNum - 1) / 3);

        this.lambda = config.lambda; // base timeout of the view-doubling synchronizer
        this.executeTimeout = this.lambda;

        this.view = 0;
        this.lastExecHeight = 0;

        this.GenesisQC = this.newQC('hot-stuff-genesis-null-QC', 0, 0, [])
        this.lockedQC = this.GenesisQC;
        this.highQC = this.GenesisQC;

        this.isDecided = false;
        this.decideCount = 0;
        this.ballots = {};
        this.isVoted = {};
        this.blocks = {};
        this.heightToBlock = {};
        this.vheight = 0;

        this.insertBlock(this.GenesisQC);
        this.nextView = {};
        this.currNextViewInterrupt = undefined;
        this.registerNewNextViewInterrupt();
        
        this.registerTimeEvent({ name: 'start', params: {} }, 0);
    }
}

module.exports = HotStuffNode;

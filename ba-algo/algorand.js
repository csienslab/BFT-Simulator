'use strict';

const Node = require('./node');
const config = require('../config');
const uuid = require('uuid/v4');

class AlgorandNode extends Node {

    extendVectors(v, until) {
        const n = until - v.length + 1
        for (let i = 0; i < n; i++) {
            v.push([]);
        }
    }

    getMaxResult(vector) {
        if (vector === undefined || vector.length === 0) {
            return { value: undefined, count: 0 };
        }
        return vector.groupBy(msg => msg.v)
            // [[value, [msg]], [value, [msg]]]
            .map(e => ({ value: e[0], count: e[1].length }))
            // [{ value: v, count: 1 }, { value: v, count: 2 }]
            .maxBy(e => e.count);
            // { value: v, count: max }
    }

    // since one node can next vote on multiple values
    // we can not use getMaxResult()
    // next vote should only contains more than 2t + 1 of any value
    // since it will skip to the next period immediately when it contains 2t + 1
    // of any value
    getMaxNextVoteResult(p) {
        if (this.nextVotes[p] === undefined || this.nextVotes[p].length === 0) {
            return { value: undefined, count: 0 };
        }
        const m = {};
        this.nextVotes[p].forEach(nextVote => {
            if (m[nextVote.v] === undefined) {
                m[nextVote.v] = [nextVote];
            }
            else {
                m[nextVote.v].push(nextVote);
            }
        });
        let maxCount = 0, value = undefined;
        for (let v in m) {
            m[v] = m[v].unique(nextVote => nextVote.sender);
            if (m[v].length > maxCount) {
                maxCount = m[v].length;
                value = v;
            }
        }
        return { value: value, count: maxCount};
    }

    decide(p) {
        let result = this.getMaxResult(this.certVotes[p]);
        if (result.count >= 2 * this.f + 1) {
            this.logger.info([`decides on ${result.value} in period ${this.p}`]);
            const proof = this.certVotes[p]
                .filter(certVote => certVote.v === result.value)
                .splice(0, 2 * this.f + 1);
            this.send(this.nodeID, 'broadcast', {
                type: 'certificate',
                v: result.value,
                p: p,
                proof: proof
            });
            this.decidedValue = result.value;
            this.isDecided = true;
        }
    }

    forwardPeriod(p) {
        if (p < this.p) return;
        const result = this.getMaxNextVoteResult(p);
        if (result.count >= 2 * this.f + 1) {
            this.p = p + 1;
            // dynamic lambda
            //this.lambda = config.lambda * Math.pow(2, this.iter - 1);
            this.step = 1;
            this.stV = result.value;
            this.runBALogic();
        }
    }

    getConditions() {
        if (this.p < 2) return { isBot: false, isValue: false, value: undefined };
        const result = this.getMaxNextVoteResult(this.p - 1);
        const isValue = (result.value !== 'BOT' && result.count >= 2 * this.f + 1);
        return { 
            isBot: (result.value === 'BOT' && result.count >= 2 * this.f + 1), 
            isValue: isValue, 
            value: (isValue) ? result.value : undefined
        };
    }

    runBALogic() {
        switch (this.step) {
        case 1: {
            const conditions = this.getConditions();
            const proposeMsg = { 
                type: 'propose',
                p: this.p, 
                randomness: Math.floor(Math.random() * 1000000000 + 1),
                sender: this.nodeID
            };
            if (this.p === 1 || (this.p >= 2 && conditions.isBot)) {
                // i proposes vi, which he propagates together with his period p credential
                proposeMsg.v = this.v;
            }
            else if (this.p >= 2 && conditions.isValue) {
                // i proposes v, which he propagates together with his period p credential
                proposeMsg.v = conditions.value;
            }
            this.send(this.nodeID, 'broadcast', proposeMsg);
            this.extendVectors(this.proposes, this.p);            
            this.proposes[this.p].push(proposeMsg);
            this.registerTimeEvent({ 
                name: 'runBALogic', 
                params: { p: this.p, step: 2 } 
            }, 2 * config.lambda * 1000);        
            break;
        }
        case 2: {
            const conditions = this.getConditions();
            const softVote = { type: 'soft', p: this.p, sender: this.nodeID };   
            if (this.p === 1 || this.p >= 2 && conditions.isBot) {
                // i identifies his leader li,p for period p and soft-votes the value v proposed by li,p
                softVote.v = this.proposes[this.p]
                    .minBy(proposeMsg => proposeMsg.randomness).v;
            }
            else if (this.p >= 2 && conditions.isValue) {
                // i soft-votes v
                softVote.v = conditions.value;
            }
            this.send(this.nodeID, 'broadcast', softVote);
            this.extendVectors(this.softVotes, this.p);        
            this.softVotes[this.p].push(softVote);
            // directly enter step 3
            this.step = 3;
            this.hasCertified.length = this.p + 1;
            this.hasCertified[this.p] = undefined;
            // directly perform step 3 condition check
            if (this.hasCertified[this.p] === undefined && 
                this.step === 3) {
                const result = this.getMaxResult(this.softVotes[this.p]);
                if (result.value !== 'BOT' && result.count >= 2 * this.f + 1) {
                    const certVote = {
                        type: 'cert',
                        p: this.p,
                        v: result.value,
                        sender: this.nodeID
                    };
                    this.hasCertified[this.p] = result.value;
                    this.send(this.nodeID, 'broadcast', certVote);
                    this.extendVectors(this.certVotes, this.p);
                    this.certVotes[this.p].push(certVote);
                }
            }
            this.registerTimeEvent({ 
                name: 'runBALogic', 
                params: { p: this.p, step: 4 } 
            }, 2 * config.lambda * 1000);
            break;
        }
        case 3: {
            // step 3 is message driven
            break;
        }
        case 4: {
            const nextVote = { type: 'next', p: this.p, sender: this.nodeID };
            const conditions = this.getConditions();
            if (this.hasCertified[this.p] !== undefined) {
                // next vote v
                nextVote.v = this.hasCertified[this.p];
            }
            else if (this.p >= 2 && conditions.isBot) {
                nextVote.v = 'BOT';
            }
            else {
                nextVote.v = this.stV;
            }
            this.send(this.nodeID, 'broadcast', nextVote);
            this.extendVectors(this.nextVotes, this.p);
            this.nextVotes[this.p].push(nextVote);
            // directly enter step 5
            this.step = 5;
            // directly perform step 5 condition check
            this.hasNextVoteBySoftVote.length = this.p + 1;
            this.hasNextVoteBySoftVote[this.p] = false;
            this.hasNextVoteByNextVote.length = this.p + 1;
            this.hasNextVoteByNextVote[this.p] = false;
            const result = this.getMaxResult(this.softVotes[this.p]);
            if (result.value !== 'BOT' && result.count >= 2 * this.f + 1) {
                const nextVote = {
                    type: 'next',
                    p: this.p,
                    v: result.value,
                    sender: this.nodeID
                };
                this.send(this.nodeID, 'broadcast', nextVote);
                this.extendVectors(this.nextVotes, this.p);
                this.nextVotes[this.p].push(nextVote);
                this.hasNextVoteBySoftVote[this.p] = true;
            }
            const condition = this.getConditions();
            if (this.p >= 2 && condition.isBot &&
                this.hasCertified[this.p] === undefined) {
                const nextVote = {
                    type: 'next',
                    p: this.p,
                    v: 'BOT',
                    sender: this.nodeID
                };
                this.send(this.nodeID, 'broadcast', nextVote);
                this.extendVectors(this.nextVotes, this.p);
                this.nextVotes[this.p].push(nextVote);
                this.hasNextVoteByNextVote[this.p] = true;                
            }
            break;
        }
        case 5: {
            // step 5 is message driven
            // TODO: directly check once
            break;
        }
        }
    }

    onMsgEvent(msgEvent) {
        super.onMsgEvent(msgEvent);
        const msg = msgEvent.packet.content;        
        this.logger.info(['recv', this.logger.round(msgEvent.triggeredTime), this.step, JSON.stringify(msg)]);
        if (this.isDecided) {
            return;
        }
        switch (msg.type) {
        case 'propose': {
            this.extendVectors(this.proposes, msg.p);
            this.proposes[msg.p].push(msg);
            break;
        }
        case 'soft': {
            this.extendVectors(this.softVotes, msg.p);
            this.softVotes[msg.p].push(msg);
            // If i sees 2t + 1 soft-votes for some value v != ⊥, then i cert-votes v
            // required msg.p === this.p?
            if (this.hasCertified[this.p] === undefined && 
                this.step === 3 && 
                this.p === msg.p) {
                const result = this.getMaxResult(this.softVotes[msg.p]);
                if (result.value !== 'BOT' && result.count >= 2 * this.f + 1) {
                    const certVote = {
                        type: 'cert',
                        p: this.p,
                        v: result.value,
                        sender: this.nodeID
                    };
                    this.hasCertified[this.p] = result.value;
                    this.send(this.nodeID, 'broadcast', certVote);
                    this.extendVectors(this.certVotes, this.p);
                    this.certVotes[this.p].push(certVote);
                }
            }
            else if (!this.hasNextVoteBySoftVote[this.p] &&
                this.step === 5 && this.p === msg.p) {
                const result = this.getMaxResult(this.softVotes[msg.p]);
                if (result.value !== 'BOT' && result.count >= 2 * this.f + 1) {
                    const nextVote = {
                        type: 'next',
                        p: this.p,
                        v: result.value,
                        sender: this.nodeID
                    };
                    this.send(this.nodeID, 'broadcast', nextVote);
                    this.extendVectors(this.nextVotes, this.p);
                    this.nextVotes[this.p].push(nextVote);
                    this.hasNextVoteBySoftVote[this.p] = true;
                }
            }
            break;
        }
        case 'cert': {
            this.extendVectors(this.certVotes, msg.p);
            this.certVotes[msg.p].push(msg);
            this.decide(msg.p);
            break;
        }
        case 'next': {
            this.extendVectors(this.nextVotes, msg.p);
            this.nextVotes[msg.p].push(msg);
            const condition = this.getConditions();
            if (!this.hasNextVoteByNextVote[this.p] &&
                this.step === 5 && 
                this.p >= 2 && condition.isBot &&
                this.hasCertified[this.p] === undefined) {
                const nextVote = {
                    type: 'next',
                    p: this.p,
                    v: 'BOT',
                    sender: this.nodeID
                };
                this.send(this.nodeID, 'broadcast', nextVote);
                this.extendVectors(this.nextVotes, this.p);
                this.nextVotes[this.p].push(nextVote);
                this.hasNextVoteByNextVote[this.p] = true;
            }
            this.forwardPeriod(msg.p);
            break;
        }
        case 'certificate': {
            msg.proof.forEach(certVote => {
                if (!this.certVotes[msg.p]
                    .some(myCertVote => myCertVote.sender === certVote.sender)) {
                    this.certVotes[msg.p].push(certVote);
                }
            });
            this.decide(msg.p);
            break;
        }
        default: 
            console.log('unknown message type:', msg);
        }
    }

    onTimeEvent(timeEvent) {
        super.onTimeEvent(timeEvent);
        const functionMeta = timeEvent.functionMeta;        
        // prevent older events
        if (functionMeta.params.p < this.p) return;
        this.step = functionMeta.params.step;
        this.runBALogic();
    }

    constructor(nodeID, nodeNum, network, registerTimeEvent) {
        super(nodeID, nodeNum, network, registerTimeEvent);
        this.f = (this.nodeNum % 3 === 0) ? 
            this.nodeNum / 3 - 1 : Math.floor(this.nodeNum / 3);
        // BA related
        this.proposes = [];
        this.certVotes = [];
        this.softVotes = [];
        this.nextVotes = [];
        this.hasCertified = [ undefined, undefined ];
        this.hasNextVoteBySoftVote = [ false, false ];
        this.hasNextVoteByNextVote = [ false, false ];
        
        this.p = 1;
        this.v = uuid();
        this.stV = 'BOT';
        
        this.isDecided = false;
        this.lambda = config.lambda;
        this.registerTimeEvent({ name: 'runBALogic', params: { p: this.p, step: 1 } }, 0);
    }
}
//const n = new DEXONNode(process.argv[2], process.argv[3]);
module.exports = AlgorandNode;

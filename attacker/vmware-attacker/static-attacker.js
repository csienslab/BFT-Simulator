'use strict';
// implement static attack for VMware BA
const config = require('../../config');
const Attacker = require('../attacker');

class StaticAttacker extends Attacker {

    attack(packets) {
        // filter packets of controlled Byzantine nodes
        const returnPackets = packets.filter(packet => {
            return !this.byzantines.has(packet.src);
        });
        if (this.mode === 'basic' || returnPackets.length === 0) {
            return returnPackets;
        }
        else if (this.mode === 'vrf' && 
            returnPackets[0].content.type === 'fl-propose') {
            const msg = returnPackets[0].content;
            this.propose.push(msg);
            if (this.propose.length === 
                config.nodeNum - this.maxByzantineNodeNum) {
                //console.log('find best vrf except byzantines');
                this.propose.sort((msgA, msgB) => {
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
                const bestProposal = this.propose[0];
                // try if we can dice a better value
                for (let chance = 0; chance < this.maxByzantineNodeNum; chance++) {
                    const y = Math.floor(Math.random() * 10000 + 1);
                    if (y > bestProposal.proposeMsg.y) {
                        // send fork value to some honest nodes
                        const proposeMsg = {
                            sender: '2',
                            type: 'fl-propose',
                            proposeMsg: {
                                sender: '2',
                                k: bestProposal.proposeMsg.k,
                                type: 'propose',
                                vL: 'x'.repeat(32),
                                // VRF
                                y: y
                            },
                            kL: bestProposal.kL,
                            CL: bestProposal.CL
                        };
                        for (let nodeID = this.maxByzantineNodeNum + 2; 
                            nodeID <= config.nodeNum; nodeID++) {
                            returnPackets.push({
                                src: '2',
                                dst: '' + nodeID,
                                content: proposeMsg,
                                delay: 0
                            });
                        }
                        break;
                    }
                }
                this.propose = [];
            }
        }
        return returnPackets;
    }

    constructor(transfer, registerTimeEvent) {
        super(transfer, registerTimeEvent);
        this.byzantines = [];
        this.maxByzantineNodeNum = (config.nodeNum % 2 === 0) ?
            config.nodeNum / 2 - 1 : Math.floor(config.nodeNum / 2);
		for (let nodeID = 2; nodeID <= this.maxByzantineNodeNum + 1; nodeID++) {
            this.byzantines.push('' + nodeID);
        }
        console.log(this.byzantines);
        this.mode = 'vrf';
        this.propose = [];
    }
}

module.exports = StaticAttacker;

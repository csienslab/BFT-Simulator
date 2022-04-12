'use strict';

const config = require('../config');
// create a partition between f and f + 1 non-Byzantine nodes
class Partitioner {

	updateParam() {
		this.isPartitionResolved = false;
		this.registerTimeEvent(
			{ name: 'resolvePartition' }, 
			this.partitionResolveTime * 1000
		);
		return false;
	}

	getDelay(mean, std) {
		let u = 0, v = 0;
		while (u === 0) u = Math.random();
		while (v === 0) v = Math.random();
		const _01BM = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
		const delay = _01BM * std + mean;
		return (delay < 0) ? 0 : delay;
	}

	getPartition(nodeID) {
		for (let i = 0; i < this.partitions.length; i++) {
			if (this.partitions[i].has(nodeID)) {
				return i;
			}
		}
	}

	attack(packets) {
		if (this.isPartitionResolved) return packets;	
		packets.forEach((packet) => {
			const srcPartition = this.getPartition(packet.src);
			const dstPartition = this.getPartition(packet.dst);
			if (srcPartition !== dstPartition) {
				packet.delay = this.getDelay(
					this.partitionDelay.mean, 
					this.partitionDelay.std
				);
			}
		});
		return packets;
	}

	onTimeEvent() {
		this.isPartitionResolved = true;
	}

	constructor(transfer, registerTimeEvent) {
		this.transfer = transfer;
		this.registerTimeEvent = registerTimeEvent;
		this.partitionResolveTime = 60;
		this.partitionDelay = { mean: 60, std: 1 };
		this.isPartitionResolved = false;
		const partitionNum = 2;
		const correctNodeNum = config.nodeNum - config.byzantineNodeNum;
		const boundaries = [];
		for (let i = 1; i < partitionNum; i++) {
			boundaries.push(Math.floor(correctNodeNum / partitionNum) * i);
		}
		this.partitions = [[]];
		let partitionIndex = 0;
		for (let nodeID = 1; nodeID <= correctNodeNum; nodeID++) {
			this.partitions[partitionIndex].push('' + nodeID);
			if (nodeID === boundaries[partitionIndex]) {
				partitionIndex++;
				this.partitions.push([]);
			}
		}
		this.registerTimeEvent(
			{ name: 'resolvePartition' }, 
			this.partitionResolveTime * 1000
		);
	}
}

module.exports = Partitioner;

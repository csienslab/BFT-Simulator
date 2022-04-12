module.exports = {
	// node
	nodeNum: 16,
	byzantineNodeNum: 0,
	// BFT protocol specific param
	lambda: 3,
	protocol: 'hotstuff-NS',
	// network environment
	networkDelay: {
		mean: 0.25,
		std: 0.05,
	},
	// close the log will run a lot faster
	logToFile: false,
	attacker: 'fail-stop',
	repeatTime: 100,
};

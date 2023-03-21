# BFT Simulator
A simulator for testing/verifying/benchmarking Byzantine Fault-Tolerant (BFT) protocols.

P. -L. Wang, T. -W. Chao, C. -C. Wu and H. -C. Hsiao
"Tool: An Efficient and Flexible Simulator for Byzantine Fault-Tolerant Protocols"
2022 52nd Annual IEEE/IFIP International Conference on Dependable Systems and Networks (DSN)

---

### Usage
```
npm i
node main.js
```

### Implemented Protocols
- Async BA
- PBFT
- VMware BA
- Algorand
- HotStuff BFT (with a naive view synchronizer)
- Libra BFT

### Attackers
- Partitioner: partition network
- VMware Static Attacker: static attacker for postponing VMware basic BA
- VMware Adaptive Attacker: adaptive attacker for postponing VMware VRF BA

### Configurations
Modify `config.js` to adjust the network environment, BFT protocol, number of nodes, attackers, etc.

### Reproduce Our Results
The `examples` directory contains several scripts to run our experiments.

### Visualization
We provide a python tool to visualize the execution of a BFT protocol. Please refer to the `README.md` file inside the `visualization` directory for more information.

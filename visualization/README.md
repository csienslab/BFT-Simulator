# Visualization
Show the network messages transmitted by each node, the view of all nodes, and the time when a consensus is reached.

Note: Currently, only PBFT and HotStuff BFT are supported.

### Usage
1. Install the required packages as indicated by `requirements.txt`.
2. Use the BFT simulator in the parent directory to generate execution traces. They will be located in the `log/` directory.
3. Run `python main.py` to visualize the execution. It will launch your browser to show the result.

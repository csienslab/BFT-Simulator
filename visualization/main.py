import argparse

def get_config_protocol(dir):
    with open(f"{dir}/config.js", 'r') as infile:
        got = infile.read()
    begin = got.find("protocol:") + 9
    end = got.find(",", begin)
    return (got[begin:end].strip())[1:-1]

if __name__ == '__main__':
    import argparse
    arg_parser = argparse.ArgumentParser(description='Visualize BFT simulation result.')
    arg_parser.add_argument("-p", "--protocol", help="specify the protocol (default: parse from config.js)", type=str)
    arg_parser.add_argument("-d", "--dir", help="path of BFT Simulator (default: current dir)", type=str, default=".")
    args = arg_parser.parse_args()

    protocol = args.protocol
    if protocol is None:
        protocol = get_config_protocol(args.dir)
    
    if protocol == "pbft":
        from parsers.pbft import PbftParser
        from visualizers.pbft import PbftVisualizer
        parser = PbftParser(args.dir)
        visualizer = PbftVisualizer()
    elif "hotstuff" in protocol:
        from parsers.hotstuff import HotStuffParser
        from visualizers.hotstuff import HotStuffVisualizer
        parser = HotStuffParser(args.dir)
        visualizer = HotStuffVisualizer()
    else:
        print(f"[!] Protocol {protocol} is currently not supported")
        exit()
    
    parsed = parser.parse()
    visualizer.draw(parsed)


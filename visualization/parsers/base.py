import os

class BaseParser:
    def __init__(self, bft_dir):
        self.dir = bft_dir
    
    def load_logs(self):
        logs = dict()
        in_dir = self.dir + "/log"
        for filename in os.listdir(in_dir):
            node_id = int(filename[:filename.find(".log")])
            with open(f"{in_dir}/{filename}", 'r') as infile:
                data = infile.read().splitlines()
            logs[node_id] = data
        return logs
    
    def parse(self):
        raise NotImplementedError()
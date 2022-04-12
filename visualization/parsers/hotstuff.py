from .base import BaseParser
import json

class HotStuffParser(BaseParser):
    def __init__(self, bft_dir):
        super().__init__(bft_dir)
    
    def parse(self):
        self.logs = self.load_logs()

        pkts = self.parse_packets()
        events = self.parse_events()
        
        return {
            "info": {"nodes": len(self.logs)}, 
            "pkts": pkts, 
            "events": events
        }
    
    def parse_send(self, line):
        tokens = line.split()
        timestamp = round(float(tokens[2][1:-1]))
        dst = tokens[3][1:-1]
        raw_data = line[line.find("{"):]
        data = json.loads(raw_data)
    
        return {
            "send_time": timestamp,
            "recv_time": -1,
            "src": int(data['src']),
            "dst": int(dst) if dst != "broadcast" else dst,
            "req": data['request'],
            "type": data['type'],
            "data": raw_data
        }
    
    def parse_recv(self, line):
        tokens = line.split()
        timestamp = round(float(tokens[2][1:-1]))
        raw_data = line[line.find("{"):]
        data = json.loads(raw_data)
    
        return {
            "recv_time": timestamp,
            "src": int(data['src']),
            "req": data["request"],
            "type": data["type"]
        }
    
    def parse_packets(self):
        pkts = []
        src_dst_req_type_to_pkt = dict()
        src_dst_req_type_to_recv = dict()
        for node_id in self.logs:
            for line in self.logs[node_id]:
                is_send = "send" in line
                is_recv = "recv" in line
                is_protocol = "request" in line
                if (not is_send and not is_recv) or not is_protocol:
                    continue
            
                if is_send:
                    pkt = self.parse_send(line)
                    if pkt['dst'] == 'broadcast':
                        for i in range(1, len(self.logs) + 1):
                            if i == node_id:
                                continue
                            new_pkt = pkt.copy()
                            new_pkt['dst'] = i
                            _key = f"{node_id}_{i}_{pkt['req']}_{pkt['type']}"
                            if _key in src_dst_req_type_to_pkt:
                                print(f"[Warning] duplicate packet: {_key}")
                            src_dst_req_type_to_pkt[_key] = new_pkt
                    else:
                        _key = f"{node_id}_{pkt['dst']}_{pkt['req']}_{pkt['type']}"
                        if _key in src_dst_req_type_to_pkt:
                            print(f"[Warning] duplicate packet: {_key}")
                        src_dst_req_type_to_pkt[_key] = pkt
                else:
                    recv = self.parse_recv(line)
                    _key = f"{recv['src']}_{node_id}_{recv['req']}_{recv['type']}"
                    if _key in src_dst_req_type_to_recv:
                        print(f"[Warning] {_key} has already been received")
                    src_dst_req_type_to_recv[_key] = recv
    
        for _key, pkt in src_dst_req_type_to_pkt.items():
            if _key not in src_dst_req_type_to_recv:
                print(f"[Warning] Missing recv pkt for {_key}")
                continue
            pkt['recv_time'] = src_dst_req_type_to_recv[_key]['recv_time']
            pkts.append(pkt)
            del src_dst_req_type_to_recv[_key]
    
        if len(src_dst_req_type_to_recv) != 0:
            print(f"[Warning] {len(src_dst_req_type_to_recv)} receives don't have corresponding sending packets")

        return pkts

    def parse_new_view(self, line, node_id):
        tokens = line.split()
        timestamp = round(float(tokens[1][1:-1]))

        return {
            "node": node_id,
            "type": "new-view",
            "timestamp": timestamp,
            "new-view": int(tokens[6]),
            # "new-timeout": round(float(tokens[10])),
        }

    def parse_reset_timeout(self, line, node_id):
        tokens = line.split()
        timestamp = round(float(tokens[1][1:-1]))

        return {
            "node": node_id,
            "type": "reset-timeout",
            "timestamp": timestamp,
            "view": int(tokens[8]),
        }

    def parse_enough_vote(self, line, node_id):
        tokens = line.split()
        timestamp = round(float(tokens[1][1:-1]))

        return {
            "node": node_id,
            "type": "enough-vote",
            "timestamp": timestamp,
        }

    def parse_events(self):
        events = []
        for node_id in self.logs:
            for line in self.logs[node_id]:
                if "new view" in line:
                    events.append(self.parse_new_view(line, node_id))
                if "reset timeout" in line:
                    events.append(self.parse_reset_timeout(line, node_id))
                if "enough vote" in line:
                    events.append(self.parse_enough_vote(line, node_id))
        return events

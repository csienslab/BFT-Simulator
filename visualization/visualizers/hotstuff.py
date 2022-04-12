from .base import BaseVisualizer
from collections import defaultdict
import plotly.graph_objects as go

class HotStuffVisualizer(BaseVisualizer):
    def draw(self, parsed_data):
        self.raw = parsed_data
        self.fig = go.Figure()

        self.process_data()

        self.draw_views()
        self.draw_packets()
        self.draw_events()

        self.fig.update_yaxes(dtick=1, fixedrange=True)
        self.fig.update_xaxes(rangemode="nonnegative", autorange=False, range=[0, 100000])
        self.fig.update_layout(hovermode="x unified")
        self.fig.show()
    
    def process_data(self):
        self.num_of_nodes = self.raw['info']['nodes']
        self.process_packets()
        self.process_events()        

    def process_packets(self):
        self.packets = []
        type_to_pkts = defaultdict(list)
        for pkt in self.raw['pkts']:
            type_to_pkts[pkt['type']].append(pkt)

        for _type, _pkts in type_to_pkts.items():
            timestamps = []
            nodes = []

            for _pkt in _pkts:
                timestamps += [_pkt["send_time"], _pkt["recv_time"], None]
                nodes += [_pkt["src"], _pkt["dst"], None]

            self.packets.append({
                "timestamps": timestamps,
                "nodes": nodes,
                "type": _type
            })

    def process_events(self):
        self.events = self.raw['events']
        self.type_to_events = defaultdict(list)
        for event in self.events:
            self.type_to_events[event['type']].append(event)
        self.process_views()

    def process_views(self):
        node_to_last_time = [0 for _ in range(self.num_of_nodes)]
        node_to_last_leader = [0 for _ in range(self.num_of_nodes)]
        self.leader_to_timestamps = [[] for _ in range(self.num_of_nodes)]
        self.leader_to_nodes = [[] for _ in range(self.num_of_nodes)]
        for view_event in self.type_to_events['new-view']:
            node_id = view_event["node"]
            _leader = node_to_last_leader[node_id - 1]

            self.leader_to_timestamps[_leader] += [node_to_last_time[node_id - 1], view_event["timestamp"], None]
            self.leader_to_nodes[_leader] += [node_id, node_id, None]

            node_to_last_leader[node_id - 1] = view_event['new-view'] % self.num_of_nodes
            node_to_last_time[node_id - 1] = view_event["timestamp"]

        # process last view
        for node_id in range(self.num_of_nodes):
            _leader = node_to_last_leader[node_id]
            begin_time = node_to_last_time[node_id]
            # get the timestamp of the last event
            last_time = begin_time
            for e in self.events:
                if e["node"] - 1 == node_id and e["timestamp"] > last_time:
                    last_time = e["timestamp"]
            self.leader_to_timestamps[_leader] += [begin_time, last_time, None]
            self.leader_to_nodes[_leader] += [node_id + 1, node_id + 1, None]
        
        del self.type_to_events['new-view']

    def draw_packets(self):
        for pkt in self.packets:
            self.fig.add_trace(go.Scatter(
                x = pkt["timestamps"], y = pkt["nodes"], name = pkt["type"], line = {'color': "#555"}
            ))

    def draw_events(self):
        symbols_dict = defaultdict(lambda : ["circle", "black"])
        symbols_dict['new-view'] = ["x", 'red']
        symbols_dict['reset-timeout'] = ['diamond', "yellow"]
        symbols_dict['enough-vote'] = ['star-open', "red"]

        for _type, _events in self.type_to_events.items():
            timestamps = []
            nodes = []

            for _event in _events:
                timestamps.append(_event['timestamp'])
                nodes.append(_event['node'])

            self.fig.add_trace(go.Scatter(
                x = timestamps, y = nodes, name = _type, mode = 'markers', marker_symbol = symbols_dict[_type][0], marker = {"size": 15, "color": symbols_dict[_type][1]}
            ))

    def draw_views(self):
        for i in range(self.num_of_nodes):
            self.fig.add_trace(go.Scatter(
                x = self.leader_to_timestamps[i], 
                y = self.leader_to_nodes[i], 
                name = f"Leader {i + 1}", 
                hovertext = f"Leader {i + 1}", 
                line = { 'width': 20 }, 
                opacity = 0.5
            ))
        

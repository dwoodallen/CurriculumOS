
function findNodeInfo(id, nodes, parent = null, index = -1) {
    for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) return { node: nodes[i], array: nodes, index: i, parent: parent };
        if (nodes[i].children) { const res = findNodeInfo(id, nodes[i].children, nodes[i], i); if (res) return res; }
    } return null;
}

const generateId = () => Math.random().toString(36).substr(2, 9);

const nodes = [
    { id: '1', title: 'Node 1', children: [{ id: '1.1', title: 'Node 1.1' }] },
    { id: '2', title: 'Node 2' }
];

const id = '1.1';
const info = findNodeInfo(id, nodes);
console.log('Info found:', !!info);

if (info) {
    const deepCopy = (node) => {
        const copy = JSON.parse(JSON.stringify(node));
        copy.id = generateId();
        copy.title = copy.title + ' (Copy)';
        if (copy.children) copy.children = copy.children.map(c => deepCopy(c));
        return copy;
    };
    info.array.splice(info.index + 1, 0, deepCopy(info.node));
    console.log('Nodes after duplication:', JSON.stringify(nodes, null, 2));
}

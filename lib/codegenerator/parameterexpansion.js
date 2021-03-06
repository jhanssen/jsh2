/*global require,module*/

module.exports = function(ast) {
    if (ast.kind) {
        // need to handle kinds, i.e. last-exit-status
        console.error(`Unhandled parameter expansion ${ast.kind}`);
    }
    if (ast.kind) {
        return this._i(`out += jsh.expandAssignment({param: "${ast.parameter}", kind: "${ast.kind}"});\n`);
    }
    return this._i(`out += jsh.expandAssignment("${ast.parameter}");\n`);
};

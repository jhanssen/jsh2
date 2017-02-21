/*global require,module*/

module.exports = function(ast) {
    return `jsh.expandAssignment("${ast.parameter}")`;
};

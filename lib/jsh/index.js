/*global module,require*/

function JSH() {
    this.shells = [];
    this.commands = new this.Commands();
};

JSH.prototype = {
};

((jsh) => {
    const all = require("./states");
    for (var k in all) {
        jsh[k] = all[k];
    }
})(JSH.prototype);

module.exports = JSH;

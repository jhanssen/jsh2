/*global require,module*/

const state = {
    shell: undefined,

    init: function init(jsh) {
        const Shell = require("./shell");
        state.shell = new Shell({ jsh: jsh });
        jsh.shells.push(state.shell);
    },

    readline: function readline(line) {
        state.shell.process(line);
    },

    complete: function complete(data, cb) {
        state.shell.complete(data, cb);
    }
};

module.exports = {
    run: function run(jsh) {
        state.init(jsh);
        const readline = require("native-readline");
        readline.start(state.readline, state.complete);
    }
};

/*global require,module,process*/
const readline = require("native-readline");

const state = {
    shell: undefined,

    init: function init(runner) {
        const Shell = require("./shell");
        state.shell = new Shell({ runner: runner });
        runner.shells.push(state.shell);
    },

    readline: function readline(line) {
        state.shell.process(line);
    },

    complete: function complete(data, cb) {
        state.shell.complete(data, cb);
    }
};

module.exports = {
    run: function run(runner) {
        readline.start(state.readline, state.complete);
        process.on("SIGINT", () => {
            readline.prompt();
        });
        state.init(runner);
    }
};

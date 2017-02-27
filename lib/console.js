/*global require,module,process*/
const readline = require("native-readline");

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
        readline.start(state.readline, state.complete);
        process.on("SIGINT", () => {
            readline.prompt();
        });
        state.init(jsh);
    }
};

// setTimeout(() => {
//     // pause
//     console.log("pausing");
//     readline.pause(() => {
//         console.log("paused");
//         setTimeout(() => {
//             readline.resume(() => {
//                 console.log("resumed");
//             });
//         }, 5000);
//     });
// }, 1000);

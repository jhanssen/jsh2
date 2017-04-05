/*global require,module*/

const homedir = require('homedir')();

async function loadrc(jshconsole)
{
    try {
        const rc = require(`${homedir}/.config/jshrc`);
        let shell = jshconsole.shell();
        let jsh = {
            commands: require("./commands"),
            completions: require("./completions"),
            setPrompt: func => { jshconsole.setPrompt(func); },
            homedir: homedir,
            shell: shell,
            // run: shell.run.bind(shell),
            // runDetached: shell.runDetached.bind(shell),
            // escape: shell.escape.bind(shell),
            // get js() { return shell.js; },
            ipc: require("./ipc/index")
        };
        await rc(jsh);
    } catch (e) {
        console.log("no rc file", e);
    }
}

module.exports = loadrc;

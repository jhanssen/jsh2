/*global require,module*/

const homedir = require('homedir')();

function loadrc(jshconsole)
{
    try {
        const rc = require(`${homedir}/.config/jshrc`);
        let shell = jshconsole.shell();
        let jsh = {
            commands: require("./commands"),
            completions: require("./completions"),
            setPrompt: func => { jshconsole.setPrompt(func); },
            homedir: homedir,
            run: shell.run.bind(shell),
            escape: shell.escape.bind(shell)
        };
        rc(jsh);
    } catch (e) {
        console.log("no rc file", e);
    }
}

module.exports = loadrc;

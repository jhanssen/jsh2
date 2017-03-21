/*global module,require*/

const minimatch = require("minimatch");

function match(clause, items)
{
    if (items instanceof Array) {
        for (let idx = 0; idx < items.length; ++idx) {
            if (minimatch(clause, items[idx]))
                return true;
        }
    } else if (typeof items === "string") {
        return minimatch(clause, items);
    }
    return false;
}

module.exports = {
    match: match
};

/*global module*/

const TokenizeState = { Normal: 0, Escaped: 1, SingleQuote: 2, DoubleQuote: 3, Expansion: 4 };

// a bit sad I have to do this since I have an otherwise decent bash parser
function tokenize(data)
{
    let buffer = data.buffer;
    let start = data.start;
    let end = data.end;
    let state = [TokenizeState.Normal];
    let lastState = () => {
        return state[state.length - 1];
    };

    let cursor = { token: undefined, pos: undefined };
    let out = [];
    let cur = "";
    let beforeStart = 0;
    let beforeEnd = 0;
    let exp = [];
    let pendingExp = undefined;
    let pendingTilde = undefined;
    let pendingBrace = false;
    let finalizePendingExp = idx => {
        if (pendingExp === undefined)
            return false;

        let text;
        if (!pendingBrace) {
            text = buffer.substr(pendingExp + 1, idx - pendingExp - 1);
        } else {
            let end = idx - 1;
            if (end < buffer.length && buffer[end] == '}') {
                text = buffer.substr(pendingExp + 2, idx - pendingExp - 3);
            } else {
                text = buffer.substr(pendingExp + 2);
            }
        }
        let lastPos = (txt) => {
            for (let i = txt.length - 1; i >= 0; --i) {
                if (txt[i] == '$')
                    return i;
            }
            return -1;
        };
        exp.push({ text: text, start: pendingExp, end: idx, token: out.length, pos: lastPos(cur), len: idx - pendingExp });
        pendingExp = undefined;
        pendingBrace = false;
        return true;
    };

    let befores = idx => {
        if (idx <= start)
            ++beforeStart;
        else if (idx < end)
            ++beforeEnd;
    };

    let addTilde = idx => {
        if (pendingTilde !== undefined) {
            exp.push({ text: buffer.substr(pendingTilde, idx - pendingTilde), token: out.length, pos: 0, len: idx - pendingTilde });
            pendingTilde = undefined;
        }
    };

    for (var i = 0; i < buffer.length; ++i) {
        if (i == start) {
            cursor.token = out.length;
        }
        if (i == end) {
            cursor.pos = cur.length;
        }

        switch (buffer[i]) {
        case '\\':
            pendingTilde = undefined;
            if (lastState() == TokenizeState.Normal) {
                if (!pendingBrace) {
                    if (finalizePendingExp(i))
                        state.pop();
                }

                state.push(TokenizeState.Escaped);
                befores(i);
                // don't reescape quotes
                // if (i + 1 < buffer.length) {
                //     switch (buffer[i + 1]) {
                //     case '"':
                //     case '\'':
                //     case ' ':
                //         befores(i);
                //         break;
                //     default:
                //         cur += '\\';
                //         break;
                //     }
                // } else {
                //     cur += '\\';
                // }
            } else if (lastState() == TokenizeState.Escaped) {
                state.pop();
                cur += '\\';
            }
            break;
        case '"':
            pendingTilde = undefined;
            if (lastState() == TokenizeState.Normal) {
                befores(i);
                state.push(TokenizeState.DoubleQuote);
            } else if (lastState() == TokenizeState.DoubleQuote) {
                if (finalizePendingExp(i))
                    state.pop();

                befores(i);
                state.pop();
            } else if (lastState() == TokenizeState.Escaped) {
                state.pop();
                cur += '"';
            }
            break;
        case '\'':
            pendingTilde = undefined;
            if (lastState() == TokenizeState.Normal) {
                befores(i);
                state.push(TokenizeState.SingleQuote);
            } else if (lastState() == TokenizeState.SingleQuote) {
                befores(i);
                state.pop();
            } else if (lastState() == TokenizeState.Escaped) {
                state.pop();
                cur += '\'';
            } else if (!pendingBrace) {
                if (finalizePendingExp(i))
                    state.pop();
            }
            break;
        case ' ':
            if (!pendingBrace) {
                if (finalizePendingExp(i))
                    state.pop();
                if (lastState() == TokenizeState.Normal) {
                    addTilde(i);

                    befores(i);
                    if (cur.length > 0) {
                        out.push(cur);
                        cur = "";
                    }
                } else {
                    cur += ' ';
                }
            } else {
                cur += ' ';
            }
            break;
        case '$':
            pendingTilde = undefined;
            switch (lastState()) {
            case TokenizeState.Normal:
            case TokenizeState.DoubleQuote:
            case TokenizeState.Expansion:
                // expansion:
                if (!pendingBrace) {
                    finalizePendingExp(i);
                    pendingExp = i;
                    if (lastState() != TokenizeState.Expansion)
                        state.push(TokenizeState.Expansion);
                }
                break;
            default:
                break;
            }
            cur += buffer[i];
            break;
        case '{':
            pendingTilde = undefined;
            if (pendingExp == i - 1) {
                // we're starting a brace expansion, continue until '}'
                pendingBrace = true;
            }
            cur += buffer[i];
            break;
        case '}':
            pendingTilde = undefined;
            if (pendingBrace) {
                if (finalizePendingExp(i + 1))
                    state.pop();
            }
            cur += buffer[i];
            break;
        case '~':
            if (lastState() == TokenizeState.Normal && !cur.length) {
                // this might be a special expansion
                pendingTilde = i;
            }
            cur += buffer[i];
            break;
        case '/':
            addTilde(i);
            // fall through
        default:
            cur += buffer[i];
            break;
        }
    }

    finalizePendingExp(i);
    addTilde(i);
    out.push(cur);

    if (cursor.token === undefined && cursor.pos === undefined) {
        if (out.length > 0 && out[out.length - 1].length > 0) {
            if (out[out.length - 1][out[out.length - 1].length - 1] == '$') {
                cursor.token = out.length -1;
                cursor.pos = out[out.length - 1].length;
            }
        }
    }

    if (cursor.token !== undefined && cursor.pos === undefined)
        cursor.pos = cur.length;

    return { tokens: out, state: lastState(),
             beforeStart: beforeStart, beforeEnd: beforeEnd,
             expansions: exp, cursor: cursor };
}

module.exports = {
    State: TokenizeState,
    tokenize: tokenize
};

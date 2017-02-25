#ifndef BUFFER_H
#define BUFFER_H

#include <vector>
#include <queue>

class Buffer
{
public:
    typedef std::vector<uint8_t> Data;

    Buffer() : mSize(0), mOffset(0) { }
    ~Buffer() { }

    void add(Data&& data);
    void add(const uint8_t* data, size_t len);

    size_t size() const { return mSize; }

    size_t read(uint8_t* data, size_t len);
    Data readAll();

private:
    size_t mSize, mOffset;
    std::queue<Data> mDatas;
};

inline void Buffer::add(Data&& data)
{
    mSize += data.size();
    mDatas.push(std::forward<Data>(data));
}

inline void Buffer::add(const uint8_t* data, size_t len)
{
    Data d(len);
    memcpy(&d[0], data, len);
    mDatas.push(std::move(d));
    mSize += len;
}

inline size_t Buffer::read(uint8_t* data, size_t len)
{
    size_t rem = len;
    size_t rd = 0;
    for (;;) {
        if (mDatas.empty())
            return rd;
        auto front = mDatas.front();
        if (front.size() - mOffset >= rem) {
            // read rem bytes, increase mOffset so we start
            // at that point the next time read() is called
            memcpy(&front[0] + mOffset, data + rd, rem);
            mOffset += rem;
            if (mOffset == front.size()) {
                mDatas.pop();
                mOffset = 0;
            }
            return rd + rem;
        } else {
            // read the entire data, decrease rem
            memcpy(&front[0] + mOffset, data + rd, front.size() - mOffset);
            mOffset = 0;
            rd += front.size() - mOffset;
            rem -= front.size() - mOffset;
            mDatas.pop();
        }
    }
}

inline Buffer::Data Buffer::readAll()
{
    Data d(mSize);
    read(&d[0], mSize);
    return d;
}

#endif

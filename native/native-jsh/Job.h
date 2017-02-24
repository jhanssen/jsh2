#ifndef JOB_H
#define JOB_H

#include "Process.h"
#include <vector>

class Job
{
    Job();
    ~Job();

    void add(Process&& proc);

    enum Mode { Foreground, Background };
    void setMode(Mode m, bool resume);

    void start();
};

#endif

/*
 * liblinebuf.so - LD_PRELOAD library that makes stdout line buffered and
 * stderr unbuffered, so that the test harness receives the log output of
 * ReGaHss line by line through a pipe (like 'stdbuf -oL -eL', but available
 * for the 32-bit ReGaHss as well).
 *
 *   gcc [-m32] -shared -fPIC -O2 -o liblinebuf.so linebuf.c
 */
#include <stdio.h>

__attribute__((constructor)) static void linebuf_init(void)
{
  setvbuf(stdout, NULL, _IOLBF, 0);
  setvbuf(stderr, NULL, _IONBF, 0);
}

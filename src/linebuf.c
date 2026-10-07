/*
 * liblinebuf.so - LD_PRELOAD library that makes stdout line buffered and
 * stderr unbuffered, so that the test harness receives the log output of
 * ReGaHss line by line through a pipe (like 'stdbuf -oL -eL', but available
 * for the 32-bit ReGaHss as well).
 *
 * LD_PRELOAD is removed from the environment afterwards, so that the
 * processes ReGaHss starts (hook scripts, system.Exec()) are not affected by
 * the preloaded libraries (which might not even match their architecture).
 *
 *   gcc [-m32] -shared -fPIC -O2 -o liblinebuf.so linebuf.c
 */
#include <stdio.h>
#include <stdlib.h>

__attribute__((constructor)) static void linebuf_init(void)
{
  setvbuf(stdout, NULL, _IOLBF, 0);
  setvbuf(stderr, NULL, _IONBF, 0);
  unsetenv("LD_PRELOAD");
}

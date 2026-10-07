/*
 * timeshift.c - shifts the realtime clock of a process by a fixed offset
 *
 * Preload library (LD_PRELOAD) used by the Y2038 tests: libfaketime keeps
 * the faked time in a 32-bit time_t when it is built for 32-bit platforms
 * and therefore cannot fake a time beyond 2038-01-19 03:14:07 UTC for the
 * time64 ABI of 32-bit glibc (it saturates at 2^31 - 1). This library only
 * adds TIMESHIFT_OFFSET seconds to the realtime clocks (CLOCK_REALTIME and
 * its variants), the monotonic clocks are not changed. Absolute timeouts on
 * the realtime clock (pthread_cond_timedwait() of condition variables using
 * CLOCK_REALTIME, pthread_mutex_timedlock(), timer_settime() with
 * TIMER_ABSTIME) are shifted back, so that waits still take as long as
 * intended.
 *
 * On 32-bit platforms both the time64 ABI (__clock_gettime64 & co., used
 * by programs built with _TIME_BITS=64) and the legacy 32-bit functions are
 * wrapped; like glibc, the legacy functions fail with EOVERFLOW once the
 * time does not fit into a 32-bit time_t anymore.
 *
 * The library is built without _TIME_BITS=64, so that time_t is the legacy
 * type of the platform:
 *
 *   gcc -shared -fPIC -O2 -o libtimeshift.so timeshift.c -ldl
 *   TIMESHIFT_OFFSET=<seconds> LD_PRELOAD=./libtimeshift.so <program>
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <pthread.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/time.h>
#include <time.h>

static int64_t offset;

static int is_realtime(clockid_t clock)
{
  return clock == CLOCK_REALTIME || clock == CLOCK_REALTIME_COARSE ||
         clock == CLOCK_REALTIME_ALARM || clock == CLOCK_TAI;
}

/* clocks of the timers created by timer_create() (to shift absolute
 * expiration times of realtime timers only) */
#define MAX_TIMERS 256
static struct {
  timer_t id;
  int realtime;
} timers[MAX_TIMERS];
static pthread_mutex_t timers_lock = PTHREAD_MUTEX_INITIALIZER;

static int timer_is_realtime(timer_t id)
{
  int realtime = 0;
  pthread_mutex_lock(&timers_lock);
  for (int i = 0; i < MAX_TIMERS; i++) {
    if (timers[i].id == id) {
      realtime = timers[i].realtime;
      break;
    }
  }
  pthread_mutex_unlock(&timers_lock);
  return realtime;
}

static void remember_timer(timer_t id, int realtime)
{
  pthread_mutex_lock(&timers_lock);
  for (int i = 0; i < MAX_TIMERS; i++) {
    if (timers[i].id == 0 || timers[i].id == id) {
      timers[i].id = id;
      timers[i].realtime = realtime;
      break;
    }
  }
  pthread_mutex_unlock(&timers_lock);
}

/* glibc: bit 1 of __wrefs is the clock of the condition variable
 * (0: CLOCK_REALTIME, 1: CLOCK_MONOTONIC) */
static int cond_is_realtime(const pthread_cond_t *cond)
{
  return (cond->__data.__wrefs & 2) == 0;
}

static int (*real_clock_gettime)(clockid_t, struct timespec *);
static int (*real_pthread_cond_timedwait)(pthread_cond_t *, pthread_mutex_t *, const struct timespec *);
static int (*real_pthread_mutex_timedlock)(pthread_mutex_t *, const struct timespec *);
static int (*real_timer_create)(clockid_t, struct sigevent *, timer_t *);
static int (*real_timer_settime)(timer_t, int, const struct itimerspec *, struct itimerspec *);

#if __TIMESIZE == 32
/* time64 ABI types of 32-bit glibc (little endian) */
struct timespec64 {
  int64_t tv_sec;
  int32_t tv_nsec;
  int32_t padding;
};
struct timeval64 {
  int64_t tv_sec;
  int64_t tv_usec;
};
struct itimerspec64 {
  struct timespec64 it_interval;
  struct timespec64 it_value;
};

static int (*real_clock_gettime64)(clockid_t, struct timespec64 *);
static int (*real_pthread_cond_timedwait64)(pthread_cond_t *, pthread_mutex_t *, const struct timespec64 *);
static int (*real_pthread_mutex_timedlock64)(pthread_mutex_t *, const struct timespec64 *);
static int (*real_timer_settime64)(timer_t, int, const struct itimerspec64 *, struct itimerspec64 *);
#endif

static void *next(const char *name)
{
  return dlsym(RTLD_NEXT, name);
}

__attribute__((constructor)) static void timeshift_init(void)
{
  const char *value = getenv("TIMESHIFT_OFFSET");
  offset = value ? strtoll(value, NULL, 10) : 0;

  real_clock_gettime = next("clock_gettime");
  real_pthread_cond_timedwait = next("pthread_cond_timedwait");
  real_pthread_mutex_timedlock = next("pthread_mutex_timedlock");
  real_timer_create = next("timer_create");
  real_timer_settime = next("timer_settime");
#if __TIMESIZE == 32
  real_clock_gettime64 = next("__clock_gettime64");
  real_pthread_cond_timedwait64 = next("__pthread_cond_timedwait64");
  real_pthread_mutex_timedlock64 = next("__pthread_mutex_timedlock64");
  real_timer_settime64 = next("__timer_settime64");
#endif
}

int timer_create(clockid_t clock, struct sigevent *sevp, timer_t *id)
{
  int result = real_timer_create(clock, sevp, id);
  if (result == 0)
    remember_timer(*id, is_realtime(clock));
  return result;
}

#if __TIMESIZE == 32

int __clock_gettime64(clockid_t clock, struct timespec64 *ts)
{
  int result = real_clock_gettime64(clock, ts);
  if (result == 0 && is_realtime(clock))
    ts->tv_sec += offset;
  return result;
}

int64_t __time64(int64_t *t)
{
  struct timespec64 ts;
  __clock_gettime64(CLOCK_REALTIME, &ts);
  if (t)
    *t = ts.tv_sec;
  return ts.tv_sec;
}

int __gettimeofday64(struct timeval64 *tv, void *tz)
{
  (void) tz;
  struct timespec64 ts;
  int result = __clock_gettime64(CLOCK_REALTIME, &ts);
  if (result == 0 && tv) {
    tv->tv_sec = ts.tv_sec;
    tv->tv_usec = ts.tv_nsec / 1000;
  }
  return result;
}

/* legacy 32-bit functions: EOVERFLOW beyond 2038 (like glibc) */
int clock_gettime(clockid_t clock, struct timespec *ts)
{
  struct timespec64 ts64;
  int result = __clock_gettime64(clock, &ts64);
  if (result != 0)
    return result;
  if (ts64.tv_sec > INT32_MAX || ts64.tv_sec < INT32_MIN) {
    errno = EOVERFLOW;
    return -1;
  }
  ts->tv_sec = (time_t) ts64.tv_sec;
  ts->tv_nsec = ts64.tv_nsec;
  return 0;
}

time_t time(time_t *t)
{
  struct timespec ts;
  if (clock_gettime(CLOCK_REALTIME, &ts) != 0)
    return (time_t) -1;
  if (t)
    *t = ts.tv_sec;
  return ts.tv_sec;
}

int gettimeofday(struct timeval *tv, void *tz)
{
  (void) tz;
  struct timespec ts;
  if (clock_gettime(CLOCK_REALTIME, &ts) != 0)
    return -1;
  if (tv) {
    tv->tv_sec = ts.tv_sec;
    tv->tv_usec = ts.tv_nsec / 1000;
  }
  return 0;
}

int __pthread_cond_timedwait64(pthread_cond_t *cond, pthread_mutex_t *mutex, const struct timespec64 *abstime)
{
  if (!abstime || !cond_is_realtime(cond))
    return real_pthread_cond_timedwait64(cond, mutex, abstime);
  struct timespec64 shifted = *abstime;
  shifted.tv_sec -= offset;
  return real_pthread_cond_timedwait64(cond, mutex, &shifted);
}

int __pthread_mutex_timedlock64(pthread_mutex_t *mutex, const struct timespec64 *abstime)
{
  if (!abstime)
    return real_pthread_mutex_timedlock64(mutex, abstime);
  struct timespec64 shifted = *abstime;
  shifted.tv_sec -= offset;
  return real_pthread_mutex_timedlock64(mutex, &shifted);
}

int __timer_settime64(timer_t id, int flags, const struct itimerspec64 *value, struct itimerspec64 *old)
{
  if (!value || !(flags & TIMER_ABSTIME) || !timer_is_realtime(id))
    return real_timer_settime64(id, flags, value, old);
  struct itimerspec64 shifted = *value;
  if (shifted.it_value.tv_sec != 0 || shifted.it_value.tv_nsec != 0)
    shifted.it_value.tv_sec -= offset;
  return real_timer_settime64(id, flags, &shifted, old);
}

#else

int clock_gettime(clockid_t clock, struct timespec *ts)
{
  int result = real_clock_gettime(clock, ts);
  if (result == 0 && is_realtime(clock))
    ts->tv_sec += offset;
  return result;
}

time_t time(time_t *t)
{
  struct timespec ts;
  clock_gettime(CLOCK_REALTIME, &ts);
  if (t)
    *t = ts.tv_sec;
  return ts.tv_sec;
}

int gettimeofday(struct timeval *tv, void *tz)
{
  (void) tz;
  struct timespec ts;
  int result = clock_gettime(CLOCK_REALTIME, &ts);
  if (result == 0 && tv) {
    tv->tv_sec = ts.tv_sec;
    tv->tv_usec = ts.tv_nsec / 1000;
  }
  return result;
}

#endif

/* legacy (32-bit) or native (64-bit) time_t variants of the waits */
int pthread_cond_timedwait(pthread_cond_t *cond, pthread_mutex_t *mutex, const struct timespec *abstime)
{
  if (!abstime || !cond_is_realtime(cond))
    return real_pthread_cond_timedwait(cond, mutex, abstime);
  struct timespec shifted = *abstime;
  shifted.tv_sec -= (time_t) offset;
  return real_pthread_cond_timedwait(cond, mutex, &shifted);
}

int pthread_mutex_timedlock(pthread_mutex_t *mutex, const struct timespec *abstime)
{
  if (!abstime)
    return real_pthread_mutex_timedlock(mutex, abstime);
  struct timespec shifted = *abstime;
  shifted.tv_sec -= (time_t) offset;
  return real_pthread_mutex_timedlock(mutex, &shifted);
}

int timer_settime(timer_t id, int flags, const struct itimerspec *value, struct itimerspec *old)
{
  if (!value || !(flags & TIMER_ABSTIME) || !timer_is_realtime(id))
    return real_timer_settime(id, flags, value, old);
  struct itimerspec shifted = *value;
  if (shifted.it_value.tv_sec != 0 || shifted.it_value.tv_nsec != 0)
    shifted.it_value.tv_sec -= (time_t) offset;
  return real_timer_settime(id, flags, &shifted, old);
}

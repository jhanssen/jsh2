#ifndef APPLY_H
#define APPLY_H

#include <functional>
#include <tuple>
#include <utility>

template <class F, std::size_t... Is>
constexpr auto index_apply_impl(F f,
                                std::index_sequence<Is...>) {
    return f(std::integral_constant<std::size_t, Is> {}...);
}

template <std::size_t N, class F>
constexpr auto index_apply(F f) {
    return index_apply_impl(f, std::make_index_sequence<N>{});
}

template <class Tuple, class F>
constexpr auto apply(Tuple t, F f) {
    return index_apply<std::tuple_size<Tuple>{}>(
        [&](auto... Is) { return f(std::get<Is>(t)...); });
}

#endif

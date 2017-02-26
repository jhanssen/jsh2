#ifndef APPLY_H
#define APPLY_H

#include <functional>
#include <tuple>
#include <utility>

// taken from http://en.cppreference.com/w/cpp/utility/integer_sequence

template<typename Func, typename Tup, std::size_t... index>
decltype(auto) apply_helper(Func&& func, Tup&& tup, std::index_sequence<index...>)
{
    return func(std::get<index>(std::forward<Tup>(tup))...);
}

template<typename Func, typename Tup>
decltype(auto) apply(Tup&& tup, Func&& func)
{
    constexpr auto Size = std::tuple_size<typename std::decay<Tup>::type>::value;
    return apply_helper(std::forward<Func>(func),
                        std::forward<Tup>(tup),
                        std::make_index_sequence<Size>{});
}
#endif

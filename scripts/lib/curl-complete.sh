# CURL is the caller's array of curl arguments (timeouts, retries, etc.).
# A regular file can be truncated by curl on retry. /dev/null cannot, and
# stdout can concatenate a partial failed response with the successful retry.
fetch_complete() {
  local response_file status=0
  response_file="$(mktemp)"
  "${CURL[@]}" --output "$response_file" "$@" || status=$?
  if [ "$status" -eq 0 ]; then
    cat "$response_file" || status=$?
  fi
  rm -- "$response_file"
  return "$status"
}

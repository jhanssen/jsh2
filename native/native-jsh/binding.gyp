{
  "targets": [
   {
      "include_dirs": [
	"<!(node -e \"require('nan')\")"
      ],
      "target_name": "native-jsh",
      "sources": [ "jsh.cpp", "utils.cpp" ]
    }
  ]
}

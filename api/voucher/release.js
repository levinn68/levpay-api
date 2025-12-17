module.exports = async (req, res) => {
  req.url = "/api/voucher?action=release";
  return require("./../voucher")(req, res);
};

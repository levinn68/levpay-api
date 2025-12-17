module.exports = async (req, res) => {
  req.url = "/api/voucher?action=apply";
  return require("./../voucher")(req, res);
};

import { Drawer } from "@mui/material";

import { PrimaryNav } from "./PrimaryNav";

/** Mobile navigation drawer. The desktop rail is hidden below md, so small
 *  screens reach navigation through the TopBar hamburger which opens this. */
export function MobileNav({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      anchor="left" open={open} onClose={onClose}
      ModalProps={{ keepMounted: true }}
      slotProps={{ paper: { sx: {
        width: 264, bgcolor: "background.paper",
        borderRight: "1px solid var(--border-default)", backgroundImage: "none",
      } } }}
    >
      <PrimaryNav expanded onNavigate={onClose} />
    </Drawer>
  );
}

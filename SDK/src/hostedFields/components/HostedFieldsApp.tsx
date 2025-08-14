import React from 'react'

const HostedFieldsApp: React.FC = () => (
  <div>
    <input placeholder="Card Number" maxLength={19} />
    <input placeholder="MM/YY" maxLength={5} />
    <input placeholder="CVV" maxLength={4} />
  </div>
)

export default HostedFieldsApp

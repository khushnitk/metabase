import React, { Component, PropTypes } from "react";

import ObjectActionSelect from "../ObjectActionSelect.jsx";

import Query from "metabase/lib/query";

export default class SegmentItem extends Component {
    static propTypes = {
        segment: PropTypes.object.isRequired,
        tableMetadata: PropTypes.object.isRequired,
        onRetire: PropTypes.func.isRequired
    };

    render() {
        let { segment, tableMetadata } = this.props;

        let description = Query.generateQueryDescription(tableMetadata, segment.definition, { sections: ["filter"], jsx: true });

        return (
            <tr className="mt1 mb3">
                <td className="px1">
                    {segment.name}
                </td>
                <td className="px1 text-ellipsis">
                    {description}
                </td>
                <td className="px1 text-centered">
                    <ObjectActionSelect
                        object={segment}
                        objectType="segment"
                        onRetire={this.props.onRetire}
                    />
                </td>
            </tr>
        )
    }
}
